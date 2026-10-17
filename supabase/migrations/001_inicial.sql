-- =====================================================================
-- Gerar Pré-Venda — estrutura no Supabase
-- Rode no SQL Editor do projeto (uma vez).
-- =====================================================================

-- Perfis dos usuários (complementa auth.users)
create table if not exists public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '',
  email text not null default '',
  papel text not null default 'operador' check (papel in ('admin', 'operador')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Cria o perfil automaticamente quando um usuário é criado
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.criar_perfil();

-- Funções auxiliares para as políticas (security definer evita recursão no RLS)
create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'admin' and ativo);
$$;

create or replace function public.eh_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo);
$$;

alter table public.perfis enable row level security;

drop policy if exists "perfil: ler o próprio ou admin" on public.perfis;
create policy "perfil: ler o próprio ou admin" on public.perfis
  for select using (id = auth.uid() or public.eh_admin());

drop policy if exists "perfil: admin altera" on public.perfis;
create policy "perfil: admin altera" on public.perfis
  for update using (public.eh_admin()) with check (public.eh_admin());

-- Histórico central de pré-vendas geradas (todos os computadores)
create table if not exists public.prevendas_geradas (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  usuario_id uuid not null default auth.uid() references auth.users (id),
  usuario_nome text not null,
  estacao text not null default '',
  conexao_cliente text not null,   -- ex.: Hage
  conexao_nome text not null,      -- ex.: COMERCIO
  banco text not null,
  ano text not null,
  numero text not null,
  cliente_codigo text not null,
  cliente_nome text not null default '',
  cliente_cnpj text not null,
  pedido_compra text not null,
  filtro text not null default 'TODOS',
  qtd_itens integer not null,
  total numeric(14, 2) not null,
  total_com_st numeric(14, 2) not null,
  arquivo_pdf text not null default ''
);

create index if not exists prevendas_geradas_pedido on public.prevendas_geradas (conexao_cliente, cliente_cnpj, pedido_compra);
create index if not exists prevendas_geradas_data on public.prevendas_geradas (criado_em desc);

alter table public.prevendas_geradas enable row level security;

drop policy if exists "histórico: usuários ativos leem" on public.prevendas_geradas;
create policy "histórico: usuários ativos leem" on public.prevendas_geradas
  for select using (public.eh_ativo());

drop policy if exists "histórico: usuário ativo registra o próprio" on public.prevendas_geradas;
create policy "histórico: usuário ativo registra o próprio" on public.prevendas_geradas
  for insert with check (public.eh_ativo() and usuario_id = auth.uid());

-- (sem update/delete: o histórico não pode ser alterado pelo programa)

-- =====================================================================
-- Primeiro administrador: depois de criar seu usuário em
-- Authentication > Users > Add user, rode (trocando o e-mail):
--
--   update public.perfis set papel = 'admin', nome = 'Ramon'
--   where email = 'seu-email@exemplo.com';
-- =====================================================================
