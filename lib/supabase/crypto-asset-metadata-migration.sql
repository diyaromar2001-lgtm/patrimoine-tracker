alter table assets
  add column if not exists crypto_custody text,
  add column if not exists staking_enabled boolean not null default false;
