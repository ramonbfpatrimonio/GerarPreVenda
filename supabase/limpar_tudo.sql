-- =====================================================================
-- Gerar Pré-Venda — LIMPAR TODO O BANCO DA NUVEM
--
-- APAGA DE VEZ (não tem como desfazer):
--   * todas as empresas
--   * todos os usuários (logins e perfis), MENOS o(s) super administrador(es)
--   * todas as conexões cadastradas
--   * todo o histórico de pré-vendas
--   * todos os eventos do sistema
--
-- MANTÉM: o super administrador (você), para conseguir entrar e recomeçar.
--         A estrutura (tabelas, regras, funções) continua igual.
--
-- Não mexe no SQL Server dos clientes: as pré-vendas geradas continuam no ERP.
--
-- Rode no Supabase → SQL Editor. Tudo roda numa transação só:
-- se der qualquer erro, nada é apagado.
-- =====================================================================

begin;

-- 1) registros
delete from public.eventos_sistema;
delete from public.prevendas_geradas;
delete from public.conexoes_empresa;

-- 2) usuários (o perfil sai junto com o login), menos os super administradores
delete from auth.users u
where not exists (
  select 1 from public.perfis p
  where p.id = u.id and p.papel = 'super_admin'
);

-- super administrador fica sem empresa
update public.perfis set empresa_id = null where papel = 'super_admin';
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'empresa_id'
where id in (select id from public.perfis where papel = 'super_admin');

-- 3) empresas
delete from public.empresas;

-- 4) os eventos das exclusões acima também saem
delete from public.eventos_sistema;

commit;

-- Conferência: tudo 0, menos "usuarios" (= super administradores mantidos)
select
  (select count(*) from public.empresas)          as empresas,
  (select count(*) from public.conexoes_empresa)  as conexoes,
  (select count(*) from public.prevendas_geradas) as historico,
  (select count(*) from public.eventos_sistema)   as eventos,
  (select count(*) from auth.users)               as usuarios,
  (select string_agg(email, ', ') from public.perfis where papel = 'super_admin') as super_admin_mantido;
