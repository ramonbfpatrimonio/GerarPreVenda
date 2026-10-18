-- =====================================================================
-- Gerar Pré-Venda — 002: várias empresas no mesmo Supabase
--
-- Rode DEPOIS do 001_inicial.sql, no SQL Editor (pode rodar mais de uma
-- vez sem estragar nada).
--
-- O que muda:
--   * tabela empresas; cada usuário pertence a uma empresa
--   * papel super_admin (você): vê e gerencia todas as empresas
--   * histórico e conexões separados por empresa (o próprio banco garante)
--   * empresa bloqueada: os usuários dela não entram nem gravam
--   * limpeza automática do histórico antigo (retenção por empresa)
--   * os dados atuais vão para a empresa "Hage" e o primeiro admin vira super_admin
-- =====================================================================

-- ---------------------------------------------------------------- tabelas
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text not null default '',
  ativa boolean not null default true,
  retencao_meses integer not null default 24 check (retencao_meses between 1 and 120),
  criado_em timestamptz not null default now()
);

alter table public.perfis add column if not exists empresa_id uuid references public.empresas (id) on delete restrict;
alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check check (papel in ('super_admin', 'admin', 'operador'));
create index if not exists perfis_empresa on public.perfis (empresa_id);

alter table public.prevendas_geradas add column if not exists empresa_id uuid references public.empresas (id) on delete cascade;
-- Identificador gerado no computador: evita registro duplicado quando a fila
-- offline reenvia.
alter table public.prevendas_geradas add column if not exists chave_local text;
create unique index if not exists prevendas_geradas_chave_local on public.prevendas_geradas (chave_local);
create index if not exists prevendas_geradas_empresa_data on public.prevendas_geradas (empresa_id, criado_em desc);

-- Cadastro das conexões de cada empresa (sem senha: a senha do SQL fica em cada computador)
create table if not exists public.conexoes_empresa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  dados jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  constraint conexoes_sem_senha check (not (dados ? 'senha') and not (dados ? 'senhaCifrada'))
);
create index if not exists conexoes_empresa_empresa on public.conexoes_empresa (empresa_id);

-- ---------------------------------------------------------------- funções de apoio
-- security definer + search_path vazio: rodam sem recursão no RLS e sem
-- risco de sequestro de nomes.
create or replace function public.minha_empresa()
returns uuid language sql stable security definer set search_path = '' as $$
  select empresa_id from public.perfis where id = auth.uid();
$$;

create or replace function public.eh_super()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'super_admin' and ativo);
$$;

-- Usuário ativo e (super_admin ou empresa ativa)
create or replace function public.usuario_liberado()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfis p left join public.empresas e on e.id = p.empresa_id
    where p.id = auth.uid() and p.ativo and (p.papel = 'super_admin' or coalesce(e.ativa, false))
  );
$$;

-- Administrador da própria empresa (liberado) ou super_admin
create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfis p left join public.empresas e on e.id = p.empresa_id
    where p.id = auth.uid() and p.ativo
      and (p.papel = 'super_admin' or (p.papel = 'admin' and coalesce(e.ativa, false)))
  );
$$;

-- Mantida por compatibilidade com o 001
create or replace function public.eh_ativo()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.usuario_liberado();
$$;

-- Perfil criado junto com o usuário. Empresa e papel vêm do app_metadata,
-- que só o servidor (Edge Function) consegue definir.
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfis (id, nome, email, empresa_id, papel)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(new.email, '@', 1)),
    coalesce(new.email, ''),
    nullif(new.raw_app_meta_data ->> 'empresa_id', '')::uuid,
    case when new.raw_app_meta_data ->> 'papel' in ('admin', 'operador') then new.raw_app_meta_data ->> 'papel' else 'operador' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Histórico: o banco define quem gravou e de qual empresa (o programa não escolhe).
create or replace function public.preparar_prevenda()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_empresa uuid;
  v_super boolean;
begin
  select p.empresa_id, p.papel = 'super_admin' into v_empresa, v_super
  from public.perfis p where p.id = auth.uid();

  new.usuario_id := auth.uid();
  -- Só o super_admin pode informar a empresa (quando está "dentro" de uma empresa)
  if not coalesce(v_super, false) or new.empresa_id is null then
    new.empresa_id := v_empresa;
  end if;
  if new.empresa_id is null then
    raise exception 'Usuário sem empresa: selecione a empresa antes de gerar.';
  end if;
  -- A fila offline envia a data original; datas absurdas viram "agora"
  if new.criado_em is null or new.criado_em > now() + interval '5 minutes' or new.criado_em < now() - interval '90 days' then
    new.criado_em := now();
  end if;
  return new;
end $$;

drop trigger if exists antes_de_registrar on public.prevendas_geradas;
create trigger antes_de_registrar before insert on public.prevendas_geradas
  for each row execute function public.preparar_prevenda();

create or replace function public.carimbar_conexao()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;

drop trigger if exists ao_salvar_conexao on public.conexoes_empresa;
create trigger ao_salvar_conexao before insert or update on public.conexoes_empresa
  for each row execute function public.carimbar_conexao();

-- ---------------------------------------------------------------- migração dos dados atuais
do $$
declare
  v_hage uuid;
  v_super uuid;
begin
  select id into v_hage from public.empresas order by criado_em limit 1;
  if v_hage is null then
    insert into public.empresas (nome, cnpj) values ('Hage', '39648061000103') returning id into v_hage;
  end if;

  if not exists (select 1 from public.perfis where papel = 'super_admin') then
    select id into v_super from public.perfis where papel = 'admin' and ativo order by criado_em limit 1;
    if v_super is not null then
      update public.perfis set papel = 'super_admin' where id = v_super;
    end if;
  end if;

  update public.perfis set empresa_id = v_hage where empresa_id is null and papel <> 'super_admin';
  update public.prevendas_geradas set empresa_id = v_hage where empresa_id is null;
end $$;

alter table public.prevendas_geradas alter column empresa_id set not null;

-- ---------------------------------------------------------------- permissões de coluna
-- Ninguém altera id, e-mail ou data de criação de um perfil pelo programa.
revoke update on public.perfis from anon, authenticated;
grant update (nome, papel, ativo, empresa_id) on public.perfis to authenticated;
-- Histórico não é alterado (só incluído, e apagado pelo super_admin/limpeza)
revoke update on public.prevendas_geradas from anon, authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.empresas enable row level security;
alter table public.perfis enable row level security;
alter table public.prevendas_geradas enable row level security;
alter table public.conexoes_empresa enable row level security;

-- empresas
drop policy if exists "empresas: ver" on public.empresas;
create policy "empresas: ver" on public.empresas
  for select using (public.eh_super() or id = public.minha_empresa());
drop policy if exists "empresas: super gerencia" on public.empresas;
create policy "empresas: super gerencia" on public.empresas
  for all using (public.eh_super()) with check (public.eh_super());

-- perfis
drop policy if exists "perfil: ler o próprio ou admin" on public.perfis;
drop policy if exists "perfil: admin altera" on public.perfis;
drop policy if exists "perfis: ver" on public.perfis;
create policy "perfis: ver" on public.perfis
  for select using (
    id = auth.uid()
    or public.eh_super()
    or (public.eh_admin() and empresa_id = public.minha_empresa())
  );
drop policy if exists "perfis: alterar" on public.perfis;
create policy "perfis: alterar" on public.perfis
  for update
  using (
    public.eh_super()
    or (public.eh_admin() and empresa_id = public.minha_empresa() and papel <> 'super_admin' and id <> auth.uid())
  )
  with check (
    public.eh_super()
    or (empresa_id = public.minha_empresa() and papel in ('admin', 'operador'))
  );

-- histórico
drop policy if exists "histórico: usuários ativos leem" on public.prevendas_geradas;
drop policy if exists "histórico: usuário ativo registra o próprio" on public.prevendas_geradas;
drop policy if exists "histórico: ver" on public.prevendas_geradas;
create policy "histórico: ver" on public.prevendas_geradas
  for select using (
    public.eh_super() or (public.usuario_liberado() and empresa_id = public.minha_empresa())
  );
drop policy if exists "histórico: registrar" on public.prevendas_geradas;
create policy "histórico: registrar" on public.prevendas_geradas
  for insert with check (
    public.usuario_liberado() and usuario_id = auth.uid()
    and (public.eh_super() or empresa_id = public.minha_empresa())
  );
drop policy if exists "histórico: super apaga" on public.prevendas_geradas;
create policy "histórico: super apaga" on public.prevendas_geradas
  for delete using (public.eh_super());

-- conexões da empresa
drop policy if exists "conexões: ver" on public.conexoes_empresa;
create policy "conexões: ver" on public.conexoes_empresa
  for select using (public.usuario_liberado() and (public.eh_super() or empresa_id = public.minha_empresa()));
drop policy if exists "conexões: admin gerencia" on public.conexoes_empresa;
create policy "conexões: admin gerencia" on public.conexoes_empresa
  for all
  using (public.eh_super() or (public.eh_admin() and empresa_id = public.minha_empresa()))
  with check (public.eh_super() or (public.eh_admin() and empresa_id = public.minha_empresa()));

-- ---------------------------------------------------------------- painel do super_admin
create or replace function public.resumo_empresas()
returns table (
  id uuid, nome text, cnpj text, ativa boolean, retencao_meses integer, criado_em timestamptz,
  usuarios bigint, prevendas_mes bigint, total_mes numeric, ultima_atividade timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.eh_super() then
    raise exception 'Apenas o super administrador.';
  end if;
  return query
  select e.id, e.nome, e.cnpj, e.ativa, e.retencao_meses, e.criado_em,
    (select count(*) from public.perfis p where p.empresa_id = e.id),
    (select count(*) from public.prevendas_geradas h where h.empresa_id = e.id and h.criado_em >= date_trunc('month', now())),
    (select coalesce(sum(h.total), 0) from public.prevendas_geradas h where h.empresa_id = e.id and h.criado_em >= date_trunc('month', now())),
    (select max(h.criado_em) from public.prevendas_geradas h where h.empresa_id = e.id)
  from public.empresas e
  order by e.nome;
end $$;
revoke execute on function public.resumo_empresas() from public, anon;
grant execute on function public.resumo_empresas() to authenticated;

-- ---------------------------------------------------------------- limpeza automática
-- Apaga do histórico da nuvem o que passou da retenção de cada empresa
-- (a pré-venda continua no ERP; sai só o registro da nuvem).
create or replace function public.limpar_historico_antigo()
returns integer language sql security definer set search_path = '' as $$
  with apagados as (
    delete from public.prevendas_geradas h
    using public.empresas e
    where e.id = h.empresa_id and h.criado_em < now() - make_interval(months => e.retencao_meses)
    returning 1
  )
  select count(*)::integer from apagados;
$$;
revoke execute on function public.limpar_historico_antigo() from public, anon, authenticated;

-- Agenda diária (precisa do pg_cron: Database > Extensions > pg_cron).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('gpv-limpeza-historico', '15 7 * * *', 'select public.limpar_historico_antigo()');
  else
    raise notice 'pg_cron não está habilitado: a limpeza automática não foi agendada. Habilite em Database > Extensions > pg_cron e rode este arquivo de novo.';
  end if;
end $$;
