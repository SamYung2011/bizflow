-- 099: RT-ship-1 — 服务端直写表补入 realtime publication。
-- 客户端订阅同步见 root-site/data/live-realtime.js；生产 ALTER 由维护者通过 psql 执行。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='shipment_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shipment_events;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='products') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='inventory_stock') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_stock;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='inventory_movements') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_movements;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='shopify_catalog_bindings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shopify_catalog_bindings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='shopify_variant_links') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shopify_variant_links;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='shopify_resource_mappings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shopify_resource_mappings;
  END IF;
END $$;
