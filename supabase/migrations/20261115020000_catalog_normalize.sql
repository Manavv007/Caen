-- Forgiving input for the Table Editor: values pasted from chats, documents
-- or spreadsheets often carry invisible characters (trailing spaces, line
-- breaks, typographic dashes like ‑ or –) that made the sku/slug format
-- checks fail with a cryptic error. Clean them up before the checks run.

-- 'Rose Halo–Ring ' -> 'rose-halo-ring' (slug) / 'ROSE-HALO-RING' (sku)
create or replace function public.catalog_code(v text, upper_case boolean) returns text
language sql immutable as $$
  select nullif(
    trim(both '-' from
      regexp_replace(
        regexp_replace(
          case when upper_case then upper(btrim(v)) else lower(btrim(v)) end,
          '[\s ‐-―−_]+', '-', 'g'),   -- spaces, NBSP, unicode dashes, underscores -> '-'
        '-{2,}', '-', 'g')),                               -- collapse repeats
    '')
$$;

create or replace function public.normalize_product() returns trigger language plpgsql as $$
begin
  new.sku := public.catalog_code(new.sku, true);
  new.slug := public.catalog_code(new.slug, false);
  new.category := public.catalog_code(new.category, false);
  new.name := btrim(new.name, E' \t\r\n ');
  new.label := btrim(coalesce(new.label, ''), E' \t\r\n ');
  new.detail := btrim(coalesce(new.detail, ''), E' \t\r\n ');
  new.description := btrim(coalesce(new.description, ''), E' \t\r\n ');
  new.image_url := btrim(new.image_url, E' \t\r\n ');
  new.image_alt := btrim(coalesce(new.image_alt, ''), E' \t\r\n ');
  new.try_on := nullif(lower(btrim(coalesce(new.try_on, ''))), '');
  return new;
end $$;

create or replace function public.normalize_category() returns trigger language plpgsql as $$
begin
  new.slug := public.catalog_code(new.slug, false);
  new.name := btrim(new.name, E' \t\r\n ');
  new.blurb := btrim(coalesce(new.blurb, ''), E' \t\r\n ');
  new.image_url := btrim(new.image_url, E' \t\r\n ');
  new.image_alt := btrim(coalesce(new.image_alt, ''), E' \t\r\n ');
  return new;
end $$;

create trigger products_normalize before insert or update on public.products
  for each row execute function public.normalize_product();
create trigger categories_normalize before insert or update on public.categories
  for each row execute function public.normalize_category();
