-- 120: bounded customer candidates. Reuse the reviewed 104 membership map
-- and 108 member-field ordering; no invoice/device snapshot is needed.
BEGIN;
CREATE OR REPLACE FUNCTION public.bizflow_order_customer_candidates(p_search text, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
WITH
  trim_chars AS MATERIALIZED (
    -- Match String.prototype.trim() in customer-groups.js.
    SELECT concat(
      chr(9), chr(10), chr(11), chr(12), chr(13), chr(32), chr(160), chr(5760),
      chr(8192), chr(8193), chr(8194), chr(8195), chr(8196), chr(8197),
      chr(8198), chr(8199), chr(8200), chr(8201), chr(8202), chr(8232),
      chr(8233), chr(8239), chr(8287), chr(12288), chr(65279)
    ) AS value
  ),
  needle AS MATERIALIZED (
    SELECT btrim(COALESCE(p_search, ''), value) AS value,
      '%' || replace(replace(replace(btrim(COALESCE(p_search, ''), value), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' AS pattern
    FROM trim_chars
  ),
  all_groups AS MATERIALIZED (SELECT * FROM public.bizflow_customer_group_map()),
  matches AS MATERIALIZED (
    SELECT DISTINCT mapping.primary_id
    FROM all_groups AS mapping
    JOIN public.customers AS customer ON customer.id = mapping.member_id
    CROSS JOIN needle
    WHERE needle.value <> '' AND (
      customer.name ILIKE needle.pattern ESCAPE E'\\'
      OR customer.phone ILIKE needle.pattern ESCAPE E'\\'
      OR customer.email ILIKE needle.pattern ESCAPE E'\\'
    )
  ),
  page_ids AS MATERIALIZED (
    SELECT matched.primary_id
    FROM matches AS matched JOIN public.customers AS customer ON customer.id = matched.primary_id
    ORDER BY customer.name ASC NULLS LAST, customer.id
    OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 1000000) LIMIT 20
  ),
  customer_groups AS MATERIALIZED (
    SELECT mapping.* FROM all_groups AS mapping JOIN page_ids AS page ON page.primary_id = mapping.primary_id
  ),
  ordered_members AS MATERIALIZED (
    SELECT
      mapping.primary_id,
      customer.id AS member_id,
      customer.parent_id,
      customer.name,
      customer.phone,
      customer.phone_mainland,
      customer.email,
      customer.address,
      customer.car_make,
      customer.car_model,
      customer.created_at,
      row_number() OVER (
        PARTITION BY mapping.primary_id
        ORDER BY
          COALESCE(parent.name, customer.name) ASC NULLS LAST,
          COALESCE(parent.id, customer.id),
          CASE WHEN customer.parent_id IS NULL THEN 0 ELSE 1 END,
          customer.name ASC NULLS LAST,
          customer.id
      ) AS member_sequence
    FROM customer_groups AS mapping
    JOIN public.customers AS customer ON customer.id = mapping.member_id
    LEFT JOIN public.customers AS parent ON parent.id = customer.parent_id
  ),
  group_ids AS MATERIALIZED (
    SELECT
      member.primary_id,
      jsonb_agg(member.member_id::text ORDER BY
        CASE WHEN member.parent_id IS NULL THEN 0 ELSE 1 END,
        member.member_sequence
      ) AS group_cids,
      min(member.created_at) FILTER (WHERE member.parent_id IS NULL) AS joined_at
    FROM ordered_members AS member
    GROUP BY member.primary_id
  ),
  field_values AS MATERIALIZED (
    SELECT member.primary_id, 'name'::text AS field_name,
           btrim(COALESCE(member.name, ''), trim_chars.value) AS value,
           member.member_sequence, 0::bigint AS line_position
    FROM ordered_members AS member CROSS JOIN trim_chars
    UNION ALL
    SELECT member.primary_id, 'phone', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.phone, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, 'phone_mainland', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.phone_mainland, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, 'email', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.email, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, 'address', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.address, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, 'car_make', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.car_make, ''), E'\n+') WITH ORDINALITY AS line(value, position)
    UNION ALL
    SELECT member.primary_id, 'car_model', btrim(line.value, trim_chars.value), member.member_sequence, line.position
    FROM ordered_members AS member CROSS JOIN trim_chars
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(member.car_model, ''), E'\n+') WITH ORDINALITY AS line(value, position)
  ),
  distinct_field_values AS MATERIALIZED (
    SELECT DISTINCT ON (value.primary_id, value.field_name, value.value)
      value.primary_id, value.field_name, value.value, value.member_sequence, value.line_position
    FROM field_values AS value
    WHERE value.value <> ''
    ORDER BY value.primary_id, value.field_name, value.value, value.member_sequence, value.line_position
  ),
  group_values AS MATERIALIZED (
    SELECT
      value.primary_id,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'name'), '[]'::jsonb) AS all_names,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'phone'), '[]'::jsonb) AS all_phones,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'phone_mainland'), '[]'::jsonb) AS all_phone_mainlands,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'email'), '[]'::jsonb) AS all_emails,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'address'), '[]'::jsonb) AS all_addresses,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'car_make'), '[]'::jsonb) AS all_car_makes,
      COALESCE(jsonb_agg(value.value ORDER BY value.member_sequence, value.line_position)
        FILTER (WHERE value.field_name = 'car_model'), '[]'::jsonb) AS all_car_models
    FROM distinct_field_values AS value
    GROUP BY value.primary_id
  ),
  candidates AS (
    SELECT customer.id, customer.name AS sort_name, jsonb_build_object(
      'id', customer.id::text, 'primaryId', customer.id::text, 'isGroupPrimary', true,
      'groupCids', ids.group_cids,
      'name', COALESCE(NULLIF(customer.name, ''), values.all_names->>0, ''),
      'phone', COALESCE(NULLIF(customer.phone, ''), values.all_phones->>0, ''),
      'detail', jsonb_build_object(
        'email', COALESCE(NULLIF(customer.email, ''), values.all_emails->>0, ''),
        'carModel', NULLIF(btrim(concat_ws(' ',
          (SELECT string_agg(value, E'\n') FROM jsonb_array_elements_text(values.all_car_makes)),
          (SELECT string_agg(value, E'\n') FROM jsonb_array_elements_text(values.all_car_models))
        )), ''),
        'shippingAddress', COALESCE(NULLIF(customer.address, ''), values.all_addresses->>0, '')
      )
    ) AS value
    FROM page_ids AS page
    JOIN public.customers AS customer ON customer.id = page.primary_id
    JOIN group_ids AS ids ON ids.primary_id = customer.id
    JOIN group_values AS values ON values.primary_id = customer.id
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(value ORDER BY sort_name ASC NULLS LAST, id) FROM candidates), '[]'::jsonb),
    'hasMore', (SELECT count(*) FROM matches) > LEAST(GREATEST(COALESCE(p_offset, 0), 0), 1000000) + 20
  );
$function$;
REVOKE ALL ON FUNCTION public.bizflow_order_customer_candidates(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bizflow_order_customer_candidates(text, integer) TO authenticated;
COMMENT ON FUNCTION public.bizflow_order_customer_candidates(text, integer) IS
  'RLS-scoped customer search, 20 primary-group candidates per request; empty search returns no candidates.';
NOTIFY pgrst, 'reload schema';
COMMIT;
