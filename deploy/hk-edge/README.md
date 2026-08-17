# HK Edge Function environment override

The tracked `docker-compose.ocpp-admin-env.yml` mirrors the mandatory
environment override at:

```text
/mnt/data/bizflow/supabase/docker/docker-compose.ocpp-admin-env.yml
```

It deliberately retains the three existing OCPP variables and adds the
Honnmono admin bridge variables. Merge the file as a unit; never recreate the
Functions container with only `docker-compose.yml`, because doing so removes
all values supplied by this override.

The same-directory deployment `.env` must contain values for:

```bash
OCPP_API_KEY=...
CHARGECMS_READAPI_URL=...
OCPP_ADMIN_INTERNAL_TOKEN=...
HONNMONO_ADMIN_API_URL=https://app-api.honnmono.top
HONNMONO_ADMIN_INTERNAL_TOKEN=<same random secret as Shenzhen>
OTA_ADMIN_URL=http://172.18.0.1:8086
OTA_ADMIN_TOKEN=<same random secret as the HK OTA admin service>
```

No secret belongs in this repository. `HONNMONO_ADMIN_INTERNAL_TOKEN` must be
at least 32 characters and must exactly match the Shenzhen backend's
`HONNMONO_ADMIN_INTERNAL_TOKEN`. `OTA_ADMIN_URL` is deliberately restricted by
the Edge function to `http://172.18.0.1:8086`; do not expose that service on a
public address.

For a Functions-only recreate, the required command shape is:

```bash
cd /mnt/data/bizflow/supabase/docker
sudo docker compose \
  -f docker-compose.yml \
  -f docker-compose.ocpp-admin-env.yml \
  up -d --no-deps functions
```

The main Compose file already carries the current PostgreSQL 17 image
configuration. Before any full-stack `up`, inspect the running containers'
Compose labels and reconcile the exact active file set. This task does not
authorize a deploy or container recreate.
