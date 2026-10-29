-- =====================================================================
-- Gerar Pré-Venda — desativa a senha antiga do(s) super administrador(es)
--
-- Depois disto o acesso master (ex.: admin@admin.com) SÓ entra com a
-- senha master do dia, pela função login-master. O programa já recusa a
-- senha antiga; este script tira ela também do Supabase.
--
-- ATENÇÃO: rode só DEPOIS de conferir que o login com a senha master
-- funciona (função login-master publicada). Para voltar atrás, troque a
-- senha do usuário em Authentication > Users.
-- =====================================================================

update auth.users u
set encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')),
    updated_at = now()
where u.id in (select p.id from public.perfis p where p.papel = 'super_admin');

select u.email, 'senha antiga desativada' as situacao
from auth.users u join public.perfis p on p.id = u.id
where p.papel = 'super_admin';
