-- Testes dos eventos do sistema (auditoria) e da aparência. Roda depois do 01.
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
update public.empresas set ativa = true where nome = 'Distribuidora Norte';
delete from public.eventos_sistema;

-- ---------------------------------------------------------------- admin da Hage mexe em conexões, no computador CAIXA-02
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
set request.headers = '{"x-estacao":"CAIXA-02"}';
insert into public.conexoes_empresa (id, empresa_id, dados) values
  ('cccccccc-0000-0000-0000-000000000001', public.minha_empresa(), '{"cliente":"Hage","nome":"FILIAL","servidor":"SRV","banco":"B1","ativo":true}');
-- salvar sem mudar nada (só a data): não deve gerar evento
update public.conexoes_empresa set dados = dados || '{"atualizadoEm":"2026-10-18"}' where id = 'cccccccc-0000-0000-0000-000000000001';
update public.conexoes_empresa set dados = dados || '{"banco":"B2"}' where id = 'cccccccc-0000-0000-0000-000000000001';
update public.conexoes_empresa set dados = dados || '{"ativo":false}' where id = 'cccccccc-0000-0000-0000-000000000001';
update public.conexoes_empresa set dados = dados || '{"ativo":true}' where id = 'cccccccc-0000-0000-0000-000000000001';
delete from public.conexoes_empresa where id = 'cccccccc-0000-0000-0000-000000000001';
-- reativa a Deyse (desativada no teste 01)
update public.perfis set ativo = true where email = 'deyse@hage.com';
do $$
declare v text;
begin
  select string_agg(acao || ':' || entidade, ',' order by id) into v from public.eventos_sistema;
  assert v = 'criou:conexão,editou:conexão,desativou:conexão,ativou:conexão,excluiu:conexão,ativou:usuário',
    'sequência de eventos inesperada: ' || coalesce(v, '(nenhum)');
  assert (select bool_and(estacao = 'CAIXA-02') from public.eventos_sistema), 'estação não registrada';
  assert (select bool_and(usuario_nome = 'Admin Hage') from public.eventos_sistema), 'usuário não registrado';
  assert (select bool_and(empresa_id = public.minha_empresa()) from public.eventos_sistema), 'empresa errada no evento';
  assert (select detalhes -> 'campos' from public.eventos_sistema where acao = 'editou' and entidade = 'conexão') = '["banco"]'::jsonb, 'campos alterados não registrados';
end $$;
-- ninguém altera um evento
do $$ begin
  begin update public.eventos_sistema set descricao = 'apagando rastro'; exception when insufficient_privilege then return; end;
  raise exception 'FALHOU: evento foi alterado';
end $$;
reset role;
\echo '✓ admin: criar, editar, desativar, ativar e excluir conexão e usuário viram eventos com estação, usuário e empresa'

-- ---------------------------------------------------------------- operadora da Hage gera pré-venda e registra login
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set request.headers = '{"x-estacao":"VENDAS-01"}';
insert into public.prevendas_geradas (usuario_nome, estacao, conexao_cliente, conexao_nome, banco, ano, numero, cliente_codigo, cliente_nome, cliente_cnpj, pedido_compra, qtd_itens, total, total_com_st, criado_em)
values ('Deyse', 'VENDAS-01', 'Hage', 'COMERCIO', 'B', '2026', '000777', '01417', 'SUPERMERCADOS DB LTDA', '22991939001765', '153331- 017', 36, 4054.23, 4093.81, now() - interval '3 hours');
select public.registrar_evento('entrou', 'sessão', 'Login no programa', '{}', 'ev-1', null, null);
select public.registrar_evento('entrou', 'sessão', 'Login no programa', '{}', 'ev-1', null, null);  -- reenvio da fila
-- tentando gravar o evento em outra empresa: o banco ignora e usa a empresa do usuário
select public.registrar_evento('saiu', 'sessão', 'x', '{}', 'ev-2', null, 'bbbbbbbb-0000-0000-0000-000000000000');
do $$ begin
  assert (select count(*) from public.eventos_sistema) = 0, 'operador não pode LER eventos';
end $$;
reset role;
do $$ begin
  assert (select count(*) from eventos_sistema where chave_local = 'ev-1') = 1, 'evento da fila duplicou';
  assert (select usuario_nome from eventos_sistema where chave_local = 'ev-1') = 'deyse', 'nome do operador';
  assert (select estacao from eventos_sistema where chave_local = 'ev-1') = 'VENDAS-01', 'estação do login';
  assert (select empresa_id from eventos_sistema where chave_local = 'ev-2') = (select empresa_id from perfis where email = 'deyse@hage.com'), 'operador gravou evento em outra empresa';
  assert (select estacao from eventos_sistema where acao = 'gerou') = 'VENDAS-01', 'estação da pré-venda';
  assert (select criado_em from eventos_sistema where acao = 'gerou') < now() - interval '2 hours', 'evento da pré-venda deve ter a hora em que foi gerada';
  assert (select descricao from eventos_sistema where acao = 'gerou') like 'Pré-venda 000777/2026 em Hage › COMERCIO%', 'descrição da pré-venda';
end $$;
\echo '✓ operador: pré-venda gerada vira evento (com a hora original); login registrado sem duplicar; não lê eventos'

-- ---------------------------------------------------------------- outra empresa e super
set role authenticated;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000a';  -- admin da Norte
do $$ begin
  assert (select count(*) from public.eventos_sistema) = 0, 'admin da Norte viu eventos da Hage';
end $$;
insert into public.eventos_sistema (acao, entidade, descricao, empresa_id) values ('exportou', 'backup', 'tentando gravar na Hage', (select id from public.empresas limit 1));
do $$ begin
  assert (select count(*) from public.eventos_sistema) = 1, 'admin da Norte vê o próprio evento';
  assert (select empresa_id from public.eventos_sistema) = 'bbbbbbbb-0000-0000-0000-000000000000', 'evento forçado para a própria empresa';
end $$;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';  -- super
update public.empresas set ativa = false where nome = 'Distribuidora Norte';
update public.empresas set ativa = true where nome = 'Distribuidora Norte';
do $$ begin
  assert (select count(*) from public.eventos_sistema where entidade = 'empresa') = 2, 'bloquear/liberar empresa deveria gerar 2 eventos';
  assert (select string_agg(acao, ',' order by id) from public.eventos_sistema where entidade = 'empresa') = 'bloqueou,liberou', 'ações da empresa';
  assert (select count(distinct empresa_id) from public.eventos_sistema) = 2, 'super vê eventos das duas empresas';
end $$;
reset role;
-- usuário desativado não registra evento
reset role;
update public.perfis set ativo = false where email = 'op@norte.com';
set role authenticated;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
do $$ begin
  begin perform public.registrar_evento('entrou', 'sessão', 'x'); exception when others then return; end;
  raise exception 'FALHOU: usuário desativado registrou evento';
end $$;
reset role;
\echo '✓ cada empresa só vê os próprios eventos; super vê todos; bloquear/liberar empresa é registrado; desativado não registra'
\echo 'TODOS OS TESTES DE EVENTOS PASSARAM'
