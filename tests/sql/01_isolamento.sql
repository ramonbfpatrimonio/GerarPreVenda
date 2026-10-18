-- Testes de isolamento entre empresas (rodar depois de 00 + 001 + 002).
-- Cada bloco roda como um usuário diferente (auth.uid simulado).
\set ON_ERROR_STOP 1
\set QUIET 1

-- ---------------------------------------------------------------- preparação (como postgres)
reset role;
insert into public.empresas (id, nome, cnpj) values ('bbbbbbbb-0000-0000-0000-000000000000', 'Distribuidora Norte', '11111111000111');
-- Usuários criados como a Edge Function cria (empresa e papel no app_metadata)
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
 ('a0000000-0000-0000-0000-00000000000a', 'admin@hage.com', '{"nome":"Admin Hage"}', jsonb_build_object('empresa_id', (select id from empresas where nome='Hage'), 'papel', 'admin')),
 ('b0000000-0000-0000-0000-00000000000a', 'admin@norte.com', '{"nome":"Admin Norte"}', '{"empresa_id":"bbbbbbbb-0000-0000-0000-000000000000","papel":"admin"}'),
 ('b0000000-0000-0000-0000-00000000000b', 'op@norte.com', '{"nome":"Op Norte"}', '{"empresa_id":"bbbbbbbb-0000-0000-0000-000000000000","papel":"operador"}'),
 ('c0000000-0000-0000-0000-00000000000c', 'tentou@sozinho.com', '{}', '{"papel":"super_admin"}');  -- criado no painel, sem empresa, tentando virar super

do $$ begin
  assert (select papel from perfis where email='admin@hage.com') = 'admin', 'admin@hage.com deveria ser admin';
  assert (select papel from perfis where email='tentou@sozinho.com') = 'operador', 'app_metadata não pode criar super_admin';
  assert (select empresa_id from perfis where email='tentou@sozinho.com') is null, 'usuário do painel fica sem empresa';
end $$;
\echo '✓ perfis criados com empresa e papel do app_metadata (ninguém nasce super_admin)'

create or replace function pg_temp.registro(p_num text, p_empresa uuid default null) returns void language sql as $$
  insert into public.prevendas_geradas (usuario_nome, conexao_cliente, conexao_nome, banco, ano, numero, cliente_codigo, cliente_cnpj, pedido_compra, qtd_itens, total, total_com_st, empresa_id)
  values ('t', 'X', 'Y', 'Z', '2026', p_num, '1', '1', 'P' || p_num, 1, 10, 10, p_empresa);
$$;
grant execute on function pg_temp.registro(text, uuid) to authenticated, anon;

-- ---------------------------------------------------------------- operador da Norte
set role authenticated;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
-- tenta gravar dizendo que é da Hage
select pg_temp.registro('900001', (select id from public.empresas where nome = 'Hage' union all select null limit 1));
do $$ begin
  assert (select count(*) from prevendas_geradas) = 1, 'operador da Norte deveria ver só o próprio registro';
  assert (select empresa_id from prevendas_geradas where numero='900001') = 'bbbbbbbb-0000-0000-0000-000000000000', 'registro deveria ir para a Norte';
  assert (select count(*) from prevendas_geradas where numero = '000500') = 0, 'Norte não pode ver histórico da Hage';
  assert (select count(*) from perfis) = 1, 'operador só vê o próprio perfil';
  assert (select count(*) from empresas) = 1, 'operador só vê a própria empresa';
  assert (select usuario_id from prevendas_geradas where numero='900001') = 'b0000000-0000-0000-0000-00000000000b', 'usuario_id definido pelo banco';
end $$;
do $$ begin
  begin perform public.resumo_empresas(); exception when others then return; end;
  raise exception 'FALHOU: operador conseguiu ver o resumo de empresas';
end $$;
do $$ begin
  update public.empresas set ativa = false;  -- não deve afetar nada
  assert (select ativa from public.empresas limit 1), 'operador não pode bloquear empresa';
end $$;
do $$ begin
  begin insert into public.conexoes_empresa (empresa_id, dados) values ('bbbbbbbb-0000-0000-0000-000000000000', '{"nome":"x"}');
  exception when insufficient_privilege then return; end;
  raise exception 'FALHOU: operador cadastrou conexão';
end $$;
reset role;
\echo '✓ operador: grava só na própria empresa, não vê Hage, não mexe em empresa nem conexões'

-- ---------------------------------------------------------------- admin da Hage
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from prevendas_geradas) = 1, 'admin Hage deveria ver só o registro antigo da Hage';
  assert (select count(*) from perfis where email like '%norte%') = 0, 'admin Hage não pode ver usuários da Norte';
  assert (select count(*) from perfis where email = 'deyse@hage.com') = 1, 'admin Hage vê usuários da Hage';
end $$;
-- promover alguém a super_admin
do $$ begin
  begin update public.perfis set papel = 'super_admin' where email = 'deyse@hage.com';
  exception when insufficient_privilege then return; end;
  raise exception 'FALHOU: admin promoveu alguém a super_admin';
end $$;
-- mover usuário para outra empresa
do $$ begin
  begin update public.perfis set empresa_id = 'bbbbbbbb-0000-0000-0000-000000000000' where email = 'deyse@hage.com';
  exception when insufficient_privilege then return; end;
  raise exception 'FALHOU: admin moveu usuário para outra empresa';
end $$;
-- mexer em usuário da Norte (não enxerga: 0 linhas)
update public.perfis set ativo = false where email = 'op@norte.com';
-- alterar o próprio papel (bloqueado: 0 linhas)
update public.perfis set papel = 'operador' where email = 'admin@hage.com';
-- alterar e-mail (sem permissão de coluna)
do $$ begin
  begin update public.perfis set email = 'x@x.com' where email = 'deyse@hage.com';
  exception when insufficient_privilege then return; end;
  raise exception 'FALHOU: admin alterou e-mail';
end $$;
-- conexões: cria para a Hage, não consegue para a Norte, e senha é recusada
insert into public.conexoes_empresa (empresa_id, dados) values ((select public.minha_empresa()), '{"cliente":"Hage","nome":"COMERCIO"}');
do $$ begin
  begin insert into public.conexoes_empresa (empresa_id, dados) values ('bbbbbbbb-0000-0000-0000-000000000000', '{"nome":"invasão"}');
  exception when insufficient_privilege then return; end;
  raise exception 'FALHOU: admin Hage cadastrou conexão na Norte';
end $$;
do $$ begin
  begin insert into public.conexoes_empresa (empresa_id, dados) values ((select public.minha_empresa()), '{"nome":"x","senha":"123"}');
  exception when check_violation then return; end;
  raise exception 'FALHOU: conexão com senha foi aceita';
end $$;
-- desativa a operadora Deyse
update public.perfis set ativo = false where email = 'deyse@hage.com';
reset role;
do $$ begin
  assert (select ativo from perfis where email='op@norte.com'), 'admin Hage desativou usuário da Norte!';
  assert (select papel from perfis where email='admin@hage.com') = 'admin', 'admin alterou o próprio papel';
  assert (select papel from perfis where email='deyse@hage.com') = 'operador', 'papel da deyse mudou';
  assert not (select ativo from perfis where email='deyse@hage.com'), 'admin deveria conseguir desativar operador da própria empresa';
end $$;
\echo '✓ admin: vê e gerencia só a própria empresa; não cria super, não troca empresa, não altera a si mesmo'

-- ---------------------------------------------------------------- usuário desativado / sem empresa
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';  -- deyse, desativada
do $$ begin
  begin perform pg_temp.registro('900002'); exception when insufficient_privilege then return; end;
  raise exception 'FALHOU: usuário desativado gravou';
end $$;
do $$ begin assert (select count(*) from prevendas_geradas) = 0, 'desativado não deveria ver histórico'; end $$;
set request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';  -- sem empresa
do $$ begin
  begin perform pg_temp.registro('900003'); exception when others then return; end;
  raise exception 'FALHOU: usuário sem empresa gravou';
end $$;
reset role;
\echo '✓ usuário desativado ou sem empresa não grava nem lê'

-- ---------------------------------------------------------------- super_admin bloqueia a Norte
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  assert (select count(*) from prevendas_geradas) = 2, 'super vê o histórico de todas as empresas';
  assert (select count(*) from public.resumo_empresas()) = 2, 'resumo deveria listar 2 empresas';
  assert (select count(*) from perfis) >= 6, 'super vê todos os usuários';
end $$;
select pg_temp.registro('900004', 'bbbbbbbb-0000-0000-0000-000000000000');
do $$ begin assert (select empresa_id from prevendas_geradas where numero='900004') = 'bbbbbbbb-0000-0000-0000-000000000000', 'super grava na empresa escolhida'; end $$;
update public.empresas set ativa = false where id = 'bbbbbbbb-0000-0000-0000-000000000000';
reset role;
set role authenticated;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';  -- operador da Norte, empresa bloqueada
do $$ begin
  begin perform pg_temp.registro('900005'); exception when insufficient_privilege then return; end;
  raise exception 'FALHOU: empresa bloqueada gravou';
end $$;
do $$ begin
  assert (select count(*) from prevendas_geradas) = 0, 'empresa bloqueada não deveria ler histórico';
  assert (select count(*) from conexoes_empresa) = 0, 'empresa bloqueada não deveria ler conexões';
end $$;
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000a';  -- admin da Norte bloqueada
do $$ begin
  begin insert into public.conexoes_empresa (empresa_id, dados) values ('bbbbbbbb-0000-0000-0000-000000000000', '{"nome":"x"}');
  exception when insufficient_privilege then return; end;
  raise exception 'FALHOU: admin de empresa bloqueada cadastrou conexão';
end $$;
reset role;
\echo '✓ super_admin vê tudo e grava na empresa escolhida; empresa bloqueada fica sem acesso'

-- ---------------------------------------------------------------- anônimo, fila offline e limpeza
set role anon;
set request.jwt.claim.sub = '';
do $$ begin
  assert (select count(*) from prevendas_geradas) = 0, 'anon viu histórico';
  assert (select count(*) from empresas) = 0, 'anon viu empresas';
  assert (select count(*) from perfis) = 0, 'anon viu perfis';
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
insert into public.prevendas_geradas (usuario_nome, conexao_cliente, conexao_nome, banco, ano, numero, cliente_codigo, cliente_cnpj, pedido_compra, qtd_itens, total, total_com_st, chave_local, criado_em)
values ('t','X','Y','Z','2026','900010','1','1','P',1,10,10,'fila-abc', now() - interval '2 days')
on conflict (chave_local) do nothing;
insert into public.prevendas_geradas (usuario_nome, conexao_cliente, conexao_nome, banco, ano, numero, cliente_codigo, cliente_cnpj, pedido_compra, qtd_itens, total, total_com_st, chave_local, criado_em)
values ('t','X','Y','Z','2026','900010','1','1','P',1,10,10,'fila-abc', now() - interval '2 days')
on conflict (chave_local) do nothing;
do $$ begin
  assert (select count(*) from prevendas_geradas where chave_local='fila-abc') = 1, 'reenvio da fila duplicou';
  assert (select criado_em::date from prevendas_geradas where chave_local='fila-abc') = (now() - interval '2 days')::date, 'data original da fila perdida';
end $$;
do $$ begin
  begin perform public.limpar_historico_antigo(); exception when insufficient_privilege then return; end;
  raise exception 'FALHOU: usuário comum executou a limpeza';
end $$;
reset role;
update public.prevendas_geradas set criado_em = now() - interval '30 months' where numero = '000500';
do $$ begin
  assert public.limpar_historico_antigo() = 1, 'limpeza deveria apagar 1 registro com mais de 24 meses';
  assert not exists (select 1 from prevendas_geradas where numero='000500'), 'registro antigo continua lá';
end $$;
\echo '✓ anônimo não vê nada; fila offline não duplica e mantém a data; limpeza respeita a retenção'
\echo 'TODOS OS TESTES DE ISOLAMENTO PASSARAM'
