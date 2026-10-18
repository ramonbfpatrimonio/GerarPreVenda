-- =====================================================================
-- Gerar Pré-Venda — 003: eventos do sistema (auditoria)
--
-- Rode DEPOIS do 002, no SQL Editor (pode rodar mais de uma vez).
--
--   * eventos_sistema: quem criou, editou, excluiu, ativou, desativou, salvou...
--     com dia, hora (com segundos), estação (computador) e usuário.
--     Os registros de conexões, usuários, empresas e pré-vendas são
--     gravados PELO BANCO (gatilhos), sem depender do programa lembrar.
--   * A aparência (fundo e logo do login) é guardada só em cada computador:
--     não há tabela para ela na nuvem.
-- =====================================================================

-- Nome do computador: o programa manda em todo pedido o cabeçalho x-estacao.
create or replace function public.estacao_atual()
returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-estacao', '');
$$;

-- ---------------------------------------------------------------- eventos
create table if not exists public.eventos_sistema (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  empresa_id uuid references public.empresas (id) on delete cascade,
  usuario_id uuid,               -- sem FK: o evento fica mesmo se o usuário for removido
  usuario_nome text not null default '',
  estacao text not null default '',
  acao text not null,            -- criou, editou, excluiu, ativou, desativou, salvou, gerou, entrou, saiu...
  entidade text not null,        -- conexão, usuário, empresa, pré-venda, aparência, sessão, backup...
  descricao text not null default '',
  detalhes jsonb not null default '{}'::jsonb,
  chave_local text               -- evita duplicar quando a fila offline reenvia
);
create unique index if not exists eventos_sistema_chave_local on public.eventos_sistema (chave_local);
create index if not exists eventos_sistema_empresa_data on public.eventos_sistema (empresa_id, criado_em desc);

-- Preenche quem, de qual empresa e de qual computador (o programa não escolhe)
create or replace function public.preparar_evento()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
  v_empresa uuid;
  v_super boolean;
begin
  if auth.uid() is not null then
    select p.nome, p.empresa_id, p.papel = 'super_admin' into v_nome, v_empresa, v_super
    from public.perfis p where p.id = auth.uid();
    new.usuario_id := auth.uid();
    new.usuario_nome := coalesce(nullif(new.usuario_nome, ''), v_nome, '');
    if not coalesce(v_super, false) or new.empresa_id is null then
      new.empresa_id := coalesce(v_empresa, new.empresa_id);
    end if;
  end if;
  if coalesce(new.estacao, '') = '' then
    new.estacao := public.estacao_atual();
  end if;
  if new.criado_em is null or new.criado_em > now() + interval '5 minutes' or new.criado_em < now() - interval '90 days' then
    new.criado_em := now();
  end if;
  return new;
end $$;

drop trigger if exists antes_de_registrar_evento on public.eventos_sistema;
create trigger antes_de_registrar_evento before insert on public.eventos_sistema
  for each row execute function public.preparar_evento();

alter table public.eventos_sistema enable row level security;
revoke update on public.eventos_sistema from anon, authenticated;

drop policy if exists "eventos: administradores leem" on public.eventos_sistema;
create policy "eventos: administradores leem" on public.eventos_sistema
  for select using (public.eh_super() or (public.eh_admin() and empresa_id = public.minha_empresa()));
drop policy if exists "eventos: usuário liberado registra" on public.eventos_sistema;
create policy "eventos: usuário liberado registra" on public.eventos_sistema
  for insert with check (
    public.usuario_liberado() and usuario_id = auth.uid()
    and (public.eh_super() or empresa_id = public.minha_empresa())
  );
drop policy if exists "eventos: super apaga" on public.eventos_sistema;
create policy "eventos: super apaga" on public.eventos_sistema
  for delete using (public.eh_super());

-- Registro de eventos pelo programa (login, backups, acesso à área administrativa...).
-- Função própria porque o operador não pode ler eventos, e o reenvio da fila
-- offline precisa de "inserir se ainda não existe".
create or replace function public.registrar_evento(
  p_acao text,
  p_entidade text,
  p_descricao text default '',
  p_detalhes jsonb default '{}'::jsonb,
  p_chave_local text default null,
  p_criado_em timestamptz default null,
  p_empresa_id uuid default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.usuario_liberado() then
    raise exception 'Usuário sem acesso.';
  end if;
  insert into public.eventos_sistema (criado_em, empresa_id, acao, entidade, descricao, detalhes, chave_local)
  values (
    p_criado_em,
    case when public.eh_super() then p_empresa_id end,  -- os demais: a empresa vem do perfil (gatilho)
    left(p_acao, 40), left(p_entidade, 40), left(coalesce(p_descricao, ''), 2000), coalesce(p_detalhes, '{}'::jsonb), p_chave_local
  )
  on conflict (chave_local) do nothing;
end $$;
revoke execute on function public.registrar_evento(text, text, text, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.registrar_evento(text, text, text, jsonb, text, timestamptz, uuid) to authenticated;

-- Aparência ficou só no computador: remove a tabela de uma versão de teste do 003
drop table if exists public.aparencia_empresa;

-- ---------------------------------------------------------------- auditoria automática
-- Só registra o que um usuário logado fez (ações da Edge Function, que roda
-- sem usuário, são registradas pelo próprio programa com o nome de quem pediu).
create or replace function public.auditar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_acao text;
  v_entidade text;
  v_desc text;
  v_emp uuid;
  v_det jsonb := '{}'::jsonb;
  v_quando timestamptz := now();
  v_estacao text := '';
  v_nome text := '';
  v_campos jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;

  if tg_table_name = 'conexoes_empresa' then
    v_entidade := 'conexão';
    v_emp := coalesce(new.empresa_id, old.empresa_id);
    if tg_op = 'INSERT' then
      v_acao := 'criou';
      v_desc := format('Conexão %s › %s (%s / %s)', new.dados ->> 'cliente', new.dados ->> 'nome', new.dados ->> 'servidor', new.dados ->> 'banco');
    elsif tg_op = 'DELETE' then
      v_acao := 'excluiu';
      v_desc := format('Conexão %s › %s (%s / %s)', old.dados ->> 'cliente', old.dados ->> 'nome', old.dados ->> 'servidor', old.dados ->> 'banco');
    else
      select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_campos
      from jsonb_object_keys(new.dados || old.dados) as k
      where k not in ('atualizadoEm') and (new.dados -> k) is distinct from (old.dados -> k);
      if jsonb_array_length(v_campos) = 0 then
        return null;
      end if;
      if coalesce((old.dados ->> 'ativo')::boolean, true) is distinct from coalesce((new.dados ->> 'ativo')::boolean, true) then
        v_acao := case when coalesce((new.dados ->> 'ativo')::boolean, true) then 'ativou' else 'desativou' end;
      else
        v_acao := 'editou';
      end if;
      v_desc := format('Conexão %s › %s', new.dados ->> 'cliente', new.dados ->> 'nome');
      v_det := jsonb_build_object('campos', v_campos);
    end if;

  elsif tg_table_name = 'perfis' then
    v_entidade := 'usuário';
    v_emp := new.empresa_id;
    if new.ativo is distinct from old.ativo then
      v_acao := case when new.ativo then 'ativou' else 'desativou' end;
      v_desc := format('Usuário %s (%s)', new.nome, new.email);
    elsif new.papel is distinct from old.papel then
      v_acao := 'editou';
      v_desc := format('Usuário %s (%s): papel %s → %s', new.nome, new.email, old.papel, new.papel);
    elsif new.nome is distinct from old.nome or new.empresa_id is distinct from old.empresa_id then
      v_acao := 'editou';
      v_desc := format('Usuário %s (%s)', new.nome, new.email);
    else
      return null;
    end if;

  elsif tg_table_name = 'empresas' then
    v_entidade := 'empresa';
    v_emp := coalesce(new.id, old.id);
    if tg_op = 'INSERT' then
      v_acao := 'criou';
      v_desc := format('Empresa %s', new.nome);
    elsif tg_op = 'DELETE' then
      v_acao := 'excluiu';
      v_desc := format('Empresa %s', old.nome);
      v_emp := null; -- a empresa deixa de existir
    elsif new.ativa is distinct from old.ativa then
      v_acao := case when new.ativa then 'liberou' else 'bloqueou' end;
      v_desc := format('Empresa %s', new.nome);
    elsif new.nome is distinct from old.nome or new.cnpj is distinct from old.cnpj or new.retencao_meses is distinct from old.retencao_meses then
      v_acao := 'editou';
      v_desc := format('Empresa %s (retenção %s meses)', new.nome, new.retencao_meses);
    else
      return null;
    end if;

  elsif tg_table_name = 'prevendas_geradas' then
    v_entidade := 'pré-venda';
    v_emp := new.empresa_id;
    v_acao := 'gerou';
    v_quando := new.criado_em;
    v_estacao := new.estacao;
    v_nome := new.usuario_nome;
    v_desc := format('Pré-venda %s/%s em %s › %s — %s — pedido %s — %s itens — R$ %s',
      new.numero, new.ano, new.conexao_cliente, new.conexao_nome,
      coalesce(nullif(new.cliente_nome, ''), new.cliente_codigo), new.pedido_compra, new.qtd_itens,
      to_char(new.total, 'FM999G999G990D00'));
  else
    return null;
  end if;

  insert into public.eventos_sistema (criado_em, empresa_id, usuario_nome, estacao, acao, entidade, descricao, detalhes)
  values (v_quando, v_emp, v_nome, v_estacao, v_acao, v_entidade, coalesce(v_desc, ''), v_det);
  return null;
end $$;

drop trigger if exists auditar_conexoes on public.conexoes_empresa;
create trigger auditar_conexoes after insert or update or delete on public.conexoes_empresa
  for each row execute function public.auditar();
drop trigger if exists auditar_perfis on public.perfis;
create trigger auditar_perfis after update on public.perfis
  for each row execute function public.auditar();
drop trigger if exists auditar_empresas on public.empresas;
create trigger auditar_empresas after insert or update or delete on public.empresas
  for each row execute function public.auditar();
drop trigger if exists auditar_prevendas on public.prevendas_geradas;
create trigger auditar_prevendas after insert on public.prevendas_geradas
  for each row execute function public.auditar();

-- ---------------------------------------------------------------- limpeza (agora também dos eventos)
create or replace function public.limpar_historico_antigo()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_h integer;
  v_e integer;
begin
  delete from public.prevendas_geradas h using public.empresas e
  where e.id = h.empresa_id and h.criado_em < now() - make_interval(months => e.retencao_meses);
  get diagnostics v_h = row_count;
  delete from public.eventos_sistema ev using public.empresas e
  where e.id = ev.empresa_id and ev.criado_em < now() - make_interval(months => e.retencao_meses);
  get diagnostics v_e = row_count;
  return v_h + v_e;
end $$;
revoke execute on function public.limpar_historico_antigo() from public, anon, authenticated;
