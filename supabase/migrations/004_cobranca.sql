-- =====================================================================
-- Gerar Pré-Venda — 004: cobrança da licença
--
-- Rode DEPOIS do 003, no SQL Editor (pode rodar mais de uma vez).
--
--   * cada empresa tem valor, ciclo (mensal, trimestral...) e vencimento
--   * parâmetros gerais: avisar N dias antes e bloquear N dias depois
--     do vencimento, e o contato do suporte mostrado nas mensagens
--   * pagamentos: o super administrador dá baixa e o vencimento avança
--     sozinho para o próximo ciclo
--   * passou da tolerância: o próprio banco bloqueia a empresa (os
--     usuários não leem nem gravam nada), até a baixa do pagamento
--   * empresa sem vencimento = sem cobrança (nunca bloqueia por isso)
-- =====================================================================

-- ---------------------------------------------------------------- licença na empresa
alter table public.empresas add column if not exists licenca_valor numeric(12, 2) not null default 0;
alter table public.empresas add column if not exists licenca_ciclo_meses integer not null default 1;
alter table public.empresas add column if not exists licenca_vencimento date;
alter table public.empresas add column if not exists licenca_obs text not null default '';
alter table public.empresas drop constraint if exists empresas_licenca_ciclo_check;
alter table public.empresas add constraint empresas_licenca_ciclo_check check (licenca_ciclo_meses in (1, 2, 3, 6, 12));

-- ---------------------------------------------------------------- parâmetros (uma linha só)
create table if not exists public.config_cobranca (
  id integer primary key default 1 check (id = 1),
  dias_aviso integer not null default 5 check (dias_aviso between 0 and 60),
  dias_tolerancia integer not null default 3 check (dias_tolerancia between 0 and 60),
  contato text not null default '',
  atualizado_em timestamptz not null default now()
);
insert into public.config_cobranca (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------- pagamentos
create table if not exists public.pagamentos_licenca (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  pago_em date not null,
  valor numeric(12, 2) not null default 0,
  forma text not null default '',
  obs text not null default '',
  vencimento_anterior date,      -- para estornar e voltar o vencimento
  vencimento_novo date not null,
  registrado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists pagamentos_licenca_empresa on public.pagamentos_licenca (empresa_id, criado_em desc);

-- ---------------------------------------------------------------- regras
-- "Hoje" no fuso de Manaus: o mesmo dia para o banco e para a tela.
create or replace function public.hoje_cobranca()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Manaus')::date;
$$;

-- Bloqueada por falta de pagamento: hoje passou do vencimento + tolerância.
create or replace function public.licenca_bloqueada(p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select e.licenca_vencimento is not null
       and public.hoje_cobranca() > e.licenca_vencimento + c.dias_tolerancia
    from public.empresas e cross join public.config_cobranca c
    where e.id = p_empresa
  ), false);
$$;

-- As funções de acesso do 002 passam a considerar a licença.
create or replace function public.usuario_liberado()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfis p left join public.empresas e on e.id = p.empresa_id
    where p.id = auth.uid() and p.ativo
      and (p.papel = 'super_admin' or (coalesce(e.ativa, false) and not public.licenca_bloqueada(e.id)))
  );
$$;

create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfis p left join public.empresas e on e.id = p.empresa_id
    where p.id = auth.uid() and p.ativo
      and (p.papel = 'super_admin' or (p.papel = 'admin' and coalesce(e.ativa, false) and not public.licenca_bloqueada(e.id)))
  );
$$;

-- Situação da licença da empresa do usuário (funciona mesmo bloqueado,
-- para o programa explicar o motivo). O super administrador pode pedir
-- a de qualquer empresa.
create or replace function public.minha_licenca(p_empresa uuid default null)
returns table (vencimento date, valor numeric, ciclo_meses integer, dias_aviso integer, dias_tolerancia integer, contato text, hoje date)
language sql stable security definer set search_path = '' as $$
  select e.licenca_vencimento, e.licenca_valor, e.licenca_ciclo_meses, c.dias_aviso, c.dias_tolerancia, c.contato, public.hoje_cobranca()
  from public.empresas e cross join public.config_cobranca c
  where e.id = case when p_empresa is not null and public.eh_super() then p_empresa else public.minha_empresa() end;
$$;
revoke execute on function public.minha_licenca(uuid) from public, anon;
grant execute on function public.minha_licenca(uuid) to authenticated;

-- Dar baixa: grava o pagamento e avança o vencimento um ciclo.
create or replace function public.registrar_pagamento(p_empresa uuid, p_pago_em date, p_valor numeric, p_forma text, p_obs text)
returns date language plpgsql security definer set search_path = '' as $$
declare
  v_venc date;
  v_ciclo integer;
  v_novo date;
begin
  if not public.eh_super() then raise exception 'Apenas o super administrador.'; end if;
  select licenca_vencimento, licenca_ciclo_meses into v_venc, v_ciclo from public.empresas where id = p_empresa for update;
  if not found then raise exception 'Empresa não encontrada.'; end if;
  -- sem vencimento ainda: o ciclo começa no dia do pagamento
  v_novo := (coalesce(v_venc, coalesce(p_pago_em, public.hoje_cobranca())) + make_interval(months => v_ciclo))::date;
  insert into public.pagamentos_licenca (empresa_id, pago_em, valor, forma, obs, vencimento_anterior, vencimento_novo)
  values (p_empresa, coalesce(p_pago_em, public.hoje_cobranca()), coalesce(p_valor, 0), coalesce(p_forma, ''), coalesce(p_obs, ''), v_venc, v_novo);
  update public.empresas set licenca_vencimento = v_novo where id = p_empresa;
  return v_novo;
end $$;
revoke execute on function public.registrar_pagamento(uuid, date, numeric, text, text) from public, anon;
grant execute on function public.registrar_pagamento(uuid, date, numeric, text, text) to authenticated;

-- Estornar: só o último pagamento da empresa; o vencimento volta ao anterior.
create or replace function public.estornar_pagamento(p_id bigint)
returns date language plpgsql security definer set search_path = '' as $$
declare
  v public.pagamentos_licenca;
begin
  if not public.eh_super() then raise exception 'Apenas o super administrador.'; end if;
  select * into v from public.pagamentos_licenca where id = p_id;
  if not found then raise exception 'Pagamento não encontrado.'; end if;
  if exists (select 1 from public.pagamentos_licenca where empresa_id = v.empresa_id and id > v.id) then
    raise exception 'Só dá para estornar o último pagamento da empresa.';
  end if;
  delete from public.pagamentos_licenca where id = p_id;
  update public.empresas set licenca_vencimento = v.vencimento_anterior where id = v.empresa_id;
  return v.vencimento_anterior;
end $$;
revoke execute on function public.estornar_pagamento(bigint) from public, anon;
grant execute on function public.estornar_pagamento(bigint) to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.config_cobranca enable row level security;
alter table public.pagamentos_licenca enable row level security;

drop policy if exists "cobrança: ler parâmetros" on public.config_cobranca;
create policy "cobrança: ler parâmetros" on public.config_cobranca
  for select to authenticated using (true);
drop policy if exists "cobrança: super altera parâmetros" on public.config_cobranca;
create policy "cobrança: super altera parâmetros" on public.config_cobranca
  for update using (public.eh_super()) with check (public.eh_super());

drop policy if exists "pagamentos: super vê" on public.pagamentos_licenca;
create policy "pagamentos: super vê" on public.pagamentos_licenca
  for select using (public.eh_super());
-- incluir e excluir só pelas funções acima (registrar / estornar)

grant select, update (dias_aviso, dias_tolerancia, contato) on public.config_cobranca to authenticated;
grant select on public.pagamentos_licenca to authenticated;
