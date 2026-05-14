# ATIVAR APP EM MODO PÚBLICO (LIVE MODE)

## ✅ PROBLEMA IDENTIFICADO E RESOLVIDO

### Page ID: CORRIGIDO ✅

O Page ID foi atualizado para `268630006333803` (Treinamento de I.A. Para Corretores de Imóveis) e está funcionando corretamente!

### Novo Problema: App em Modo de Desenvolvimento

**Erro atual:**

```
error_subcode: 1885183
error_user_title: "O post do criativo dos anúncios foi criado por um app que está em modo de desenvolvimento"
error_user_msg: "Ele deve estar em modo público para criar este anúncio."
```

## SOLUÇÃO: Ativar o App em Modo Público

### Passo a Passo

#### 1. Acesse o Meta App Dashboard

```
https://developers.facebook.com/apps/3175000345993024/settings/basic/
```

#### 2. Localize a Seção "App Mode"

No topo da página, você verá um indicador mostrando se o app está em:

- 🔴 **Development Mode** (Modo de Desenvolvimento) ← Estado Atual
- 🟢 **Live Mode** (Modo Público) ← Estado Necessário

#### 3. Mude para Live Mode

**IMPORTANTE:** Antes de mudar para Live Mode, verifique se o app atende aos requisitos:

1. **Privacy Policy URL** (Política de Privacidade)
   - Deve estar preenchida
   - URL válida e acessível
   - Exemplo: `https://www.chatbotimoveis.com.br/privacidade`

2. **Terms of Service URL** (Termos de Serviço) - Opcional mas recomendado
   - Exemplo: `https://www.chatbotimoveis.com.br/termos`

3. **App Icon** - Deve ter um ícone configurado

4. **Business Verification** - Pode ser necessário para alguns casos

#### 4. Ativar Live Mode

Na página de configurações básicas:

1. Role até a seção **"App Mode"**
2. Clique no botão **"Switch to Live Mode"** ou **"Ativar Modo Público"**
3. Confirme a mudança

**OU**

Se houver um toggle switch no topo da página:

1. Clique no switch de "Development" para "Live"
2. Confirme a mudança

#### 5. Verificar Status

Depois de ativar:

- O indicador deve mostrar **🟢 Live**
- O app estará disponível publicamente
- Anúncios poderão ser criados normalmente

## Se Faltar a Privacy Policy URL

Se o app não deixar ativar Live Mode por falta de Privacy Policy:

### Opção 1: Usar URL Temporária (Para Testes)

```
https://www.chatbotimoveis.com.br/privacy
```

### Opção 2: Criar Página de Privacidade Simples

Se você tem acesso ao site chatbotimoveis.com.br, crie uma página simples de privacidade.

Modelo básico:

```
Política de Privacidade - Chatbot Imóveis

Data de vigência: [DATA]

O Chatbot Imóveis respeita sua privacidade e está comprometido em proteger seus dados pessoais.

1. Dados Coletados
- Informações de contato fornecidas voluntariamente
- Dados de uso do aplicativo

2. Uso dos Dados
- Melhorar nossos serviços
- Comunicação com usuários
- Criação de anúncios personalizados

3. Compartilhamento
- Não compartilhamos seus dados com terceiros sem consentimento

4. Contato
Email: contato@chatbotimoveis.com.br

[Resto do texto legal padrão]
```

### Opção 3: Continuar em Development Mode (Limitado)

Se não puder ativar Live Mode agora, você pode:

- Adicionar testadores ao app (máximo 5-10 usuários)
- Esses testadores poderão ver os anúncios em teste
- Limitado para produção real

**Para adicionar testadores:**

1. Vá em: https://developers.facebook.com/apps/3175000345993024/roles/
2. Adicione usuários como "Testadores" ou "Desenvolvedores"

## Verificar se Funcionou

Depois de ativar Live Mode, execute:

```bash
python test_correct_page.py
```

Se o teste passar, execute a automação completa:

```bash
python run_automation.py
```

## Resumo das Correções Feitas

1. ✅ **Page ID corrigido**: `268630006333803`
2. ✅ **Página acessível**: "Treinamento de I.A. Para Corretores de Imóveis"
3. ⚠️ **App Mode**: Precisa mudar de Development → Live

## URLs Úteis

- **App Dashboard**: https://developers.facebook.com/apps/3175000345993024/dashboard/
- **App Settings**: https://developers.facebook.com/apps/3175000345993024/settings/basic/
- **App Roles**: https://developers.facebook.com/apps/3175000345993024/roles/
- **Business Manager**: https://business.facebook.com/settings/

---

**NOTA:** Mudar para Live Mode é um processo de um clique (se tiver Privacy Policy configurada). Não afeta suas configurações existentes, apenas permite que o app seja usado publicamente.
