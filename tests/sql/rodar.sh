#!/bin/sh
# Recria um banco de teste e roda: Supabase simulado -> 001 -> dados antigos -> 002 (2x) -> testes
# Uso: PGHOST=/caminho PGPORT=5432 PGUSER=postgres sh tests/sql/rodar.sh
set -e
P="psql -v ON_ERROR_STOP=1 -q -X"
$P -d postgres -c "drop database if exists gpv_teste" -c "create database gpv_teste" >/dev/null
for r in anon authenticated service_role; do $P -d postgres -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='$r') then execute 'create role $r nologin'; end if; end \$\$" >/dev/null; done
sed '/^create role/d' tests/sql/00_supabase_simulado.sql | $P -d gpv_teste >/dev/null
$P -d gpv_teste -f supabase/migrations/001_inicial.sql 2>/dev/null
$P -d gpv_teste -c "insert into auth.users (id,email,raw_user_meta_data) values ('11111111-1111-1111-1111-111111111111','adm@patrimonio.com','{\"nome\":\"Ramon\"}'), ('22222222-2222-2222-2222-222222222222','deyse@hage.com','{}'); update perfis set papel='admin' where email='adm@patrimonio.com';" \
   -c "set role authenticated; set request.jwt.claim.sub='11111111-1111-1111-1111-111111111111'; insert into prevendas_geradas (usuario_nome,conexao_cliente,conexao_nome,banco,ano,numero,cliente_codigo,cliente_cnpj,pedido_compra,qtd_itens,total,total_com_st) values ('Ramon','Hage','COMERCIO','Hage.0001.Log','2026','000500','01417','22991939001765','153331- 017',36,4054.23,4093.81);"
$P -d gpv_teste -f supabase/migrations/002_empresas.sql 2>/dev/null
$P -d gpv_teste -f supabase/migrations/002_empresas.sql 2>/dev/null
$P -d gpv_teste -f supabase/migrations/003_eventos_aparencia.sql 2>/dev/null
$P -d gpv_teste -f supabase/migrations/003_eventos_aparencia.sql 2>/dev/null
$P -d gpv_teste -f tests/sql/01_isolamento.sql 2>&1 | grep -E "✓|FALHOU|ERROR|PASSARAM"
$P -d gpv_teste -f tests/sql/02_eventos.sql 2>&1 | grep -E "✓|FALHOU|ERROR|PASSARAM"
