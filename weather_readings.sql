-- Race Weather Supabase project (ref oqdwrselsrxhkwtxmtct)
-- Already applied to the live project on 2026-11-10. Kept here as a record and
-- so the setup can be rebuilt if the project is ever recreated.

-- 1. Storage --------------------------------------------------------------
create table public.weather_readings (
  ts                  timestamptz primary key,
  temp_f              double precision not null,
  humidity_pct        double precision not null,
  abs_pressure_inhg   double precision not null,
  vapor_pressure_inhg double precision,
  dew_point_f         double precision,
  humidity_grains     double precision,
  adr                 double precision,
  adr2                double precision,
  density_alt_ft      double precision,
  correction          double precision,
  uv_index            double precision,
  recorded_at         timestamptz not null default now()
);

alter table public.weather_readings enable row level security;

-- The website has no login, so reads are public. Nobody can write through the
-- API; only the database-side recorder below inserts rows.
revoke all on public.weather_readings from anon, authenticated;
grant select on public.weather_readings to anon, authenticated;

create policy "Anyone can read weather readings"
  on public.weather_readings for select
  to anon, authenticated
  using (true);

-- 2. Recorder -------------------------------------------------------------
create extension if not exists http with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;

-- Fetches the site's current reading and stores it. Runs inside the database
-- only; the private schema is not exposed through the API.
create or replace function private.record_weather_reading()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  resp extensions.http_response;
  d jsonb;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');

  select * into resp
  from extensions.http_get('https://www.elitetrackweather.com/api/live');

  -- The site answers 500 when the outdoor sensor is off (off-season); just skip.
  if resp.status <> 200 then
    return 'skipped: site returned ' || resp.status || ' ' || left(coalesce(resp.content, ''), 200);
  end if;

  d := resp.content::jsonb -> 'display';

  if d is null
     or d->>'ts' is null
     or d->>'tempF' is null
     or d->>'humidityPct' is null
     or d->>'absPressureInHg' is null then
    return 'skipped: response had no usable reading';
  end if;

  insert into public.weather_readings (
    ts, temp_f, humidity_pct, abs_pressure_inhg, vapor_pressure_inhg, dew_point_f,
    humidity_grains, adr, adr2, density_alt_ft, correction, uv_index
  ) values (
    (d->>'ts')::timestamptz,
    (d->>'tempF')::double precision,
    (d->>'humidityPct')::double precision,
    (d->>'absPressureInHg')::double precision,
    (d->>'vaporPressureInHg')::double precision,
    (d->>'dewPointF')::double precision,
    (d->>'humidityGrains')::double precision,
    (d->>'adr')::double precision,
    (d->>'adr2')::double precision,
    (d->>'densityAltFt')::double precision,
    (d->>'correction')::double precision,
    (d->>'uvIndex')::double precision
  )
  on conflict (ts) do nothing;

  return 'recorded ' || (d->>'ts');
end;
$$;

revoke all on function private.record_weather_reading() from public, anon, authenticated;

-- Every minute.
select cron.schedule(
  'record-weather-reading',
  '* * * * *',
  $$select private.record_weather_reading()$$
);

-- Keep the scheduler's own run log from growing forever.
select cron.schedule(
  'purge-cron-run-history',
  '17 9 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
