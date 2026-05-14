# 🔑 Configuração das Credenciais Meta Ads API

## ⚠️ IMPORTANTE

As credenciais copiadas do projeto `chatbot-imoveis` incluem:

- ✅ **OpenAI API Key** - PRONTA PARA USO
- ✅ **Anthropic API Key** - PRONTA PARA USO
- ⚠️ **Meta Access Token** - É do WhatsApp Business, NÃO do Meta Ads

---

## 📋 O QUE VOCÊ PRECISA FAZER

Para usar a automação de anúncios na Meta, você precisa configurar credenciais específicas do **Meta Ads Manager**:

### 1️⃣ Criar um App Meta for Business

1. Acesse: https://developers.facebook.com/apps
2. Clique em "Criar App"
3. Selecione o tipo: **"Business"**
4. Preencha:
   - Nome do app: "Automação Anúncios Imóveis"
   - Email de contato: seu email
   - Conta de Business: selecione sua conta
5. Clique em "Criar App"

---

### 2️⃣ Obter App ID e App Secret

1. No painel do app, vá em **Configurações > Básico**
2. Copie:
   - **App ID** → Cole no `.env` em `META_APP_ID`
   - **App Secret** (clique em "Mostrar") → Cole no `.env` em `META_APP_SECRET`

```env
META_APP_ID=1234567890
META_APP_SECRET=abcdef1234567890abcdef1234567890
```

---

### 3️⃣ Obter Access Token com Permissões de Ads

1. Acesse: https://developers.facebook.com/tools/explorer/
2. Selecione seu aplicativo no dropdown superior direito
3. Em "Permissões", adicione estas permissões:
   - ✅ `ads_management`
   - ✅ `business_management`
   - ✅ `pages_read_engagement`
   - ✅ `pages_show_list`
4. Clique em "Gerar Token de Acesso"
5. Copie o token gerado

```env
META_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### 4️⃣ Estender a Validade do Token (IMPORTANTE!)

O token inicial expira em 1-2 horas. Para uso em produção:

1. Acesse: https://developers.facebook.com/tools/debug/accesstoken/
2. Cole o token gerado
3. Clique em "Extend Access Token"
4. Copie o novo token (válido por 60 dias)
5. Atualize o `.env` com o novo token

**Alternativa (Token permanente):**

```bash
curl -i -X GET "https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=SEU_APP_ID&client_secret=SEU_APP_SECRET&fb_exchange_token=SEU_TOKEN_CURTO"
```

---

### 5️⃣ Obter Ad Account ID

1. Acesse: https://business.facebook.com/settings/ad-accounts
2. Selecione sua conta de anúncios
3. O ID aparece na URL ou nas configurações
4. Formato: `act_123456789`

```env
META_AD_ACCOUNT_ID=act_123456789
```

---

### 6️⃣ Obter Page ID (Opcional)

Para anúncios que linkam a uma página do Facebook:

1. Acesse sua página do Facebook
2. Vá em **Configurações > Sobre**
3. Procure por "ID da Página"
4. Copie o número

```env
META_PAGE_ID=1234567890
```

---

## 🔐 Arquivo .env Final

Seu arquivo `.env` deve ficar assim:

```env
# OpenAI (JÁ CONFIGURADO)
OPENAI_API_KEY=sk-proj-kweHQ7ZkUdIg8fcW2ptscxtiffmyi_c1rtXxcsprl-...

# Meta Ads API (CONFIGURE ESTES)
META_APP_ID=1234567890
META_APP_SECRET=abcdef1234567890abcdef1234567890
META_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
META_AD_ACCOUNT_ID=act_123456789
META_PAGE_ID=1234567890
```

---

## ✅ Testar Configuração

Após configurar, teste se está funcionando:

```bash
python -c "from meta_ads_manager import MetaAdsManager; from dotenv import load_dotenv; load_dotenv(); MetaAdsManager(); print('✅ Credenciais OK!')"
```

Se aparecer "✅ Credenciais OK!", está tudo certo!

---

## 🆘 Problemas Comuns

### Erro: "Invalid OAuth access token"

**Causa:** Token expirado ou sem permissões

**Solução:**

1. Gere um novo token no Graph API Explorer
2. Verifique se adicionou as permissões necessárias
3. Estenda a validade do token

### Erro: "Permissions error"

**Causa:** Faltam permissões no token

**Solução:**

1. No Graph API Explorer, adicione:
   - `ads_management`
   - `business_management`
2. Gere novo token

### Erro: "Ad account not found"

**Causa:** ID da conta incorreto

**Solução:**

1. Verifique se o ID tem o prefixo `act_`
2. Confirme que você tem acesso à conta
3. Vá em https://business.facebook.com/settings/ad-accounts

---

## 📞 Links Úteis

- **Criar App:** https://developers.facebook.com/apps
- **Graph API Explorer:** https://developers.facebook.com/tools/explorer/
- **Debug Token:** https://developers.facebook.com/tools/debug/accesstoken/
- **Ad Accounts:** https://business.facebook.com/settings/ad-accounts
- **Documentação:** https://developers.facebook.com/docs/marketing-apis

---

## 💡 Resumo Rápido

1. ✅ **OpenAI API Key** - Já configurada
2. ⚠️ **Meta App ID** - Crie um app em developers.facebook.com
3. ⚠️ **Meta App Secret** - Copie do painel do app
4. ⚠️ **Meta Access Token** - Gere no Graph API Explorer com permissões
5. ⚠️ **Meta Ad Account ID** - Copie de business.facebook.com

**Tempo estimado de configuração:** 10-15 minutos

---

**Após configurar tudo, execute:**

```bash
python example_real_estate.py
```

E seus anúncios serão criados automaticamente! 🚀
