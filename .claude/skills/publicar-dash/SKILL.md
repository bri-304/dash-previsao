---
name: publicar-dash
description: Publica a versão aprovada de src/ no projeto de produção do Forecast (mesma URL), depois que a Brianna aprovou no teste. Use quando ela disser "pode publicar", "sobe pro link oficial", "publica essa versão".
---

# Publicar no link oficial

Teste e produção são dois projetos: o `.clasp-teste.json` é o teste e o `.clasp.json` (padrão do clasp) é a produção. O link oficial só muda quando a implantação de produção aponta para uma versão nova. Nunca crie outra implantação de produção: isso gera outra URL.

1. Confirme que a Brianna aprovou no teste. Sem aprovação explícita, pare e pergunte.
2. `git status`: tudo que vai ser publicado precisa estar commitado.
3. `clasp push --force` envia `src/` para a produção.
4. `clasp create-version "<o que mudou>"` e anote o número `N`.
5. Aponte o link oficial para essa versão, com o Deployment ID da seção "IDs" do CLAUDE.md e descrição fixa:
   `clasp update-deployment <DEPLOYMENT_ID> --versionNumber <N> --description "Dashboard Forecast de Vendas"`
6. `clasp list-deployments`: confira que o Deployment ID oficial mostra `@N`. Se não mudou, não diga que está publicado.
7. Se `oauthScopes` mudou no manifesto, avise a Brianna: ela precisa autorizar de novo no editor do projeto de produção.
8. Diga, em uma frase, que está publicado e que quem estiver com o dash aberto precisa recarregar. O link divulgado é sempre o com `/a/~/`: `https://script.google.com/a/~/macros/s/<DEPLOYMENT_ID>/exec`.
9. Tag git: `git tag v<N>` e `git push origin apps-script v<N>`.

Se algo der errado: volte para a versão anterior com `clasp update-deployment <DEPLOYMENT_ID> --versionNumber <N-1> --description "Dashboard Forecast de Vendas"`.
