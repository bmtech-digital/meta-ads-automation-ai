# Guia Rápido de Início

## 🚀 5 Passos para Começar

### 1️⃣ Instalar Dependências (2 minutos)

```bash
pip install -r requirements.txt
```

### 2️⃣ Configurar Credenciais (5 minutos)

Copie o arquivo de exemplo:

```bash
copy .env.example .env
```

Edite `.env` e preencha suas credenciais:

```env
OPENAI_API_KEY=sk-proj-xxxxxxxxx           # De: platform.openai.com/api-keys
META_APP_ID=1234567890                     # De: developers.facebook.com/apps
META_APP_SECRET=abcdef123456               # De: developers.facebook.com/apps
META_ACCESS_TOKEN=EAAxxxxxxxxx             # De: developers.facebook.com/tools/explorer
META_AD_ACCOUNT_ID=act_1234567890          # De: business.facebook.com/settings/ad-accounts
META_PAGE_ID=1234567890                    # De: sua página do Facebook
```

### 3️⃣ Testar Geração de Imagem (30 segundos)

```python
from image_generator import ImageGenerator
from dotenv import load_dotenv

load_dotenv()
generator = ImageGenerator()

result = generator.generate_image(
    prompt="Modern apartment with ocean view",
    save_path="./test_image.png"
)

print(f"✅ Imagem gerada: {result['url']}")
```

Execute:

```bash
python -c "from image_generator import ImageGenerator; from dotenv import load_dotenv; load_dotenv(); g=ImageGenerator(); r=g.generate_image('Modern apartment', save_path='test.png'); print('OK')"
```

### 4️⃣ Testar Conexão Meta (30 segundos)

```python
from meta_ads_manager import MetaAdsManager
from dotenv import load_dotenv

load_dotenv()
manager = MetaAdsManager()

print("✅ Conectado à Meta Ads API!")
```

Execute:

```bash
python -c "from meta_ads_manager import MetaAdsManager; from dotenv import load_dotenv; load_dotenv(); MetaAdsManager(); print('OK')"
```

### 5️⃣ Criar Seu Primeiro Anúncio! (1 minuto)

```python
from automation_main import AdAutomation

automation = AdAutomation()

result = automation.create_ad_with_ai_image(
    image_prompt="Beautiful modern apartment interior",
    campaign_name="Minha Primeira Campanha",
    ad_title="Apartamento Incrível",
    ad_body="Conheça este imóvel maravilhoso!",
    link_url="https://www.seusite.com",
    daily_budget=5000  # R$ 50,00
)

print(f"🎉 Anúncio criado! ID: {result['meta_ad']['ad_id']}")
```

---

## 📋 Checklist de Configuração

- [ ] Python 3.8+ instalado
- [ ] Dependências instaladas (`pip install -r requirements.txt`)
- [ ] Arquivo `.env` criado e preenchido
- [ ] OpenAI API Key válida
- [ ] Meta App criado
- [ ] Meta Access Token gerado com permissões corretas
- [ ] Meta Ad Account ID configurado
- [ ] Teste de geração de imagem funcionando
- [ ] Teste de conexão Meta funcionando

---

## ⚡ Comandos Úteis

### Executar Exemplo Completo

```bash
python automation_main.py
```

### Testar Apenas Imagens

```bash
python image_generator.py
```

### Testar Apenas Meta Ads

```bash
python meta_ads_manager.py
```

### Instalar em Ambiente Virtual

```bash
python -m venv venv
venv\Scripts\activate  # Windows
# ou: source venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
```

---

## 🆘 Problemas Comuns

### "ModuleNotFoundError: No module named 'openai'"

**Solução:** Execute `pip install -r requirements.txt`

### "OPENAI_API_KEY não encontrada"

**Solução:** Verifique se o arquivo `.env` existe e está preenchido corretamente

### "Invalid OAuth access token"

**Solução:**

1. Gere novo token em: https://developers.facebook.com/tools/explorer/
2. Adicione permissões: `ads_management`, `business_management`
3. Atualize o `.env`

---

## 📞 Links Importantes

- **OpenAI API Keys:** https://platform.openai.com/api-keys
- **Meta Developers:** https://developers.facebook.com/apps
- **Graph API Explorer:** https://developers.facebook.com/tools/explorer/
- **Meta Business Manager:** https://business.facebook.com
- **Documentação Completa:** Veja `README.md`

---

## 💡 Primeiro Teste Recomendado

Use este código para seu primeiro teste (BAIXO CUSTO):

```python
from automation_main import AdAutomation

automation = AdAutomation()

# TESTE COM ORÇAMENTO MÍNIMO
result = automation.create_ad_with_ai_image(
    # Imagem simples
    image_prompt="Modern apartment living room",
    image_quality="standard",  # Mais barato

    # Campanha de teste
    campaign_name="TESTE - Primeira Campanha",
    ad_title="Teste de Anúncio",
    ad_body="Este é um teste de automação.",
    link_url="https://www.seusite.com",
    daily_budget=2000,  # Apenas R$ 20,00

    # Segmentação mínima
    targeting={
        'geo_locations': {'countries': ['BR']},
        'age_min': 25,
        'age_max': 55
    }
)

if result['success']:
    print("✅ SUCESSO! Automação funcionando perfeitamente!")
    print(f"📱 Ad ID: {result['meta_ad']['ad_id']}")
    print(f"🖼️ Imagem: {result['image']['local_path']}")
else:
    print("❌ Erro:", result.get('error'))
```

**IMPORTANTE:** O anúncio será criado como **PAUSADO**. Você pode ativá-lo manualmente no Meta Ads Manager após revisar.

---

**Pronto! Você está preparado para criar anúncios automaticamente! 🚀**
