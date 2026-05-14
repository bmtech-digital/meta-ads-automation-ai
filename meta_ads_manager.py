"""
Meta Ads Manager — create campaigns, ad sets, creatives, and ads via the Marketing API.
"""

import os
import subprocess
import sys
import tempfile

import requests as http_requests
from facebook_business.adobjects.ad import Ad
from facebook_business.adobjects.adaccount import AdAccount
from facebook_business.adobjects.adcreative import AdCreative
from facebook_business.adobjects.adimage import AdImage
from facebook_business.adobjects.adset import AdSet
from facebook_business.adobjects.advideo import AdVideo
from facebook_business.adobjects.campaign import Campaign
from facebook_business.api import FacebookAdsApi


class MetaAdsManager:
    """Classe para gerenciar anúncios na plataforma Meta"""

    def __init__(
        self,
        app_id: str | None = None,
        app_secret: str | None = None,
        access_token: str | None = None,
        ad_account_id: str | None = None,
    ):
        """
        Inicializa o gerenciador de anúncios Meta

        Args:
            app_id: ID do aplicativo Meta
            app_secret: Secret do aplicativo
            access_token: Token de acesso do usuário
            ad_account_id: ID da conta de anúncios (formato: act_xxxxx)
        """
        self.app_id = app_id or os.getenv("META_APP_ID")
        self.app_secret = app_secret or os.getenv("META_APP_SECRET")
        self.access_token = access_token or os.getenv("META_ACCESS_TOKEN")
        self.ad_account_id = ad_account_id or os.getenv("META_AD_ACCOUNT_ID")

        # Validar credenciais
        if not all([self.app_id, self.app_secret, self.access_token, self.ad_account_id]):
            raise ValueError(
                "Credenciais Meta incompletas. Configure META_APP_ID, META_APP_SECRET, "
                "META_ACCESS_TOKEN e META_AD_ACCOUNT_ID no .env"
            )

        # Inicializar API
        FacebookAdsApi.init(
            app_id=self.app_id, app_secret=self.app_secret, access_token=self.access_token
        )

        self.ad_account = AdAccount(self.ad_account_id)
        self._usdils_rate = None
        print(f"✅ Meta Ads API inicializada para conta: {self.ad_account_id}", file=sys.stderr)

    @property
    def usdils_rate(self) -> float:
        """Fetch and cache the current USD/ILS exchange rate."""
        if self._usdils_rate is None:
            try:
                resp = http_requests.get(
                    "https://open.er-api.com/v6/latest/USD",
                    timeout=5,
                )
                self._usdils_rate = resp.json()["rates"]["ILS"]
            except Exception:
                self._usdils_rate = 3.6  # fallback
                print("⚠️ Could not fetch live rate, using fallback 3.60")
            print(f"💱 USD/ILS rate: {self._usdils_rate:.2f}")
        return self._usdils_rate

    def usd_to_agorot(self, usd: float) -> int:
        """Convert a USD amount to agorot (ILS cents) using live exchange rate."""
        ils = usd * self.usdils_rate
        return int(ils * 100)

    def upload_image(self, image_path: str, image_name: str | None = None) -> str:
        """
        Faz upload de uma imagem para a biblioteca de anúncios

        Args:
            image_path: Caminho local da imagem
            image_name: Nome da imagem (opcional)

        Returns:
            Hash da imagem para usar em criativos
        """
        print(f"📤 Fazendo upload da imagem: {image_path}")

        try:
            image = AdImage(parent_id=self.ad_account_id)
            image[AdImage.Field.filename] = image_path

            if image_name:
                image[AdImage.Field.name] = image_name

            image.remote_create()
            image_hash = image[AdImage.Field.hash]

            print(f"✅ Upload concluído! Hash: {image_hash}")
            return image_hash

        except Exception as e:
            print(f"❌ Erro no upload da imagem: {str(e)}")
            raise

    def create_campaign(
        self,
        name: str,
        objective: str = "OUTCOME_TRAFFIC",
        status: str = "PAUSED",
        special_ad_categories: list | None = None,
    ) -> Campaign:
        """
        Cria uma nova campanha

        Args:
            name: Nome da campanha
            objective: Objetivo da campanha (OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT,
                      OUTCOME_LEADS, OUTCOME_SALES, etc.)
            status: Status inicial (PAUSED, ACTIVE)
            special_ad_categories: Categorias especiais (ex: ['HOUSING', 'CREDIT'])

        Returns:
            Objeto Campaign criado
        """
        print(f"📢 Criando campanha: {name}")

        try:
            params = {
                Campaign.Field.name: name,
                Campaign.Field.objective: objective,
                Campaign.Field.status: status,
            }

            params[Campaign.Field.special_ad_categories] = special_ad_categories or []

            # Novo requisito da Meta API: budget sharing
            params["is_adset_budget_sharing_enabled"] = False

            campaign = self.ad_account.create_campaign(params=params)

            print(f"✅ Campanha criada! ID: {campaign.get_id()}")
            return campaign

        except Exception as e:
            print(f"❌ Erro ao criar campanha: {str(e)}")
            raise

    def create_ad_set(
        self,
        campaign_id: str,
        name: str,
        daily_budget_usd: float,
        targeting: dict,
        optimization_goal: str = "LINK_CLICKS",
        billing_event: str = "IMPRESSIONS",
        bid_amount: int | None = None,
    ) -> AdSet:
        """
        Create an ad set.

        Args:
            campaign_id: Campaign ID
            name: Ad set name
            daily_budget_usd: Daily budget in USD (converted to agorot via live USD/ILS rate)
            targeting: Targeting dict (countries, ages, etc.)
            optimization_goal: Optimization goal
            billing_event: Billing event
            bid_amount: Bid amount in agorot (optional, defaults to 10% of daily budget)

        Returns:
            AdSet object
        """
        daily_budget_agorot = self.usd_to_agorot(daily_budget_usd)
        print(
            f"🎯 Creating ad set: {name} (${daily_budget_usd:.2f}/day = {daily_budget_agorot} agorot)"
        )

        try:
            params = {
                AdSet.Field.name: name,
                AdSet.Field.campaign_id: campaign_id,
                AdSet.Field.daily_budget: daily_budget_agorot,
                AdSet.Field.billing_event: billing_event,
                AdSet.Field.optimization_goal: optimization_goal,
                AdSet.Field.targeting: {
                    **targeting,
                    "targeting_automation": {"advantage_audience": 0},
                },
                AdSet.Field.status: "PAUSED",
            }

            if bid_amount:
                params[AdSet.Field.bid_amount] = bid_amount
            else:
                params[AdSet.Field.bid_amount] = int(daily_budget_agorot * 0.1)

            ad_set = self.ad_account.create_ad_set(params=params)

            print(f"✅ Conjunto criado! ID: {ad_set.get_id()}")
            return ad_set

        except Exception as e:
            print(f"❌ Erro ao criar conjunto: {str(e)}")
            raise

    def create_ad_creative(
        self,
        name: str,
        image_hash: str,
        title: str,
        body: str,
        link_url: str,
        call_to_action_type: str = "LEARN_MORE",
        page_id: str | None = None,
    ) -> AdCreative:
        """
        Cria um criativo de anúncio

        Args:
            name: Nome do criativo
            image_hash: Hash da imagem (retornado por upload_image)
            title: Título do anúncio
            body: Texto principal
            link_url: URL de destino
            call_to_action_type: Tipo de call-to-action
            page_id: ID da página do Facebook (opcional)

        Returns:
            Objeto AdCreative criado
        """
        print(f"🎨 Criando criativo: {name}")

        try:
            page_id = page_id or os.getenv("META_PAGE_ID")

            object_story_spec = {
                "page_id": page_id,
                "link_data": {
                    "image_hash": image_hash,
                    "link": link_url,
                    "message": body,
                    "name": title,
                    "call_to_action": {"type": call_to_action_type, "value": {"link": link_url}},
                },
            }

            params = {
                AdCreative.Field.name: name,
                AdCreative.Field.object_story_spec: object_story_spec,
            }

            creative = self.ad_account.create_ad_creative(params=params)

            print(f"✅ Criativo criado! ID: {creative.get_id()}")
            return creative

        except Exception as e:
            print(f"❌ Erro ao criar criativo: {str(e)}")
            raise

    def create_ad(self, ad_set_id: str, creative_id: str, name: str, status: str = "PAUSED") -> Ad:
        """
        Cria um anúncio

        Args:
            ad_set_id: ID do conjunto de anúncios
            creative_id: ID do criativo
            name: Nome do anúncio
            status: Status inicial (PAUSED, ACTIVE)

        Returns:
            Objeto Ad criado
        """
        print(f"📱 Criando anúncio: {name}")

        try:
            params = {
                Ad.Field.name: name,
                Ad.Field.adset_id: ad_set_id,
                Ad.Field.creative: {"creative_id": creative_id},
                Ad.Field.status: status,
            }

            ad = self.ad_account.create_ad(params=params)

            print(f"✅ Anúncio criado! ID: {ad.get_id()}")
            return ad

        except Exception as e:
            print(f"❌ Erro ao criar anúncio: {str(e)}")
            raise

    def upload_video(self, video_path: str, video_name: str | None = None) -> str:
        """
        Upload a video to the ad account's video library.

        Args:
            video_path: Local path to the video file
            video_name: Display name for the video (optional)

        Returns:
            Video ID for use in creatives
        """
        print(f"📤 Uploading video: {video_path}")

        try:
            video = AdVideo(parent_id=self.ad_account_id)
            video[AdVideo.Field.filepath] = video_path

            if video_name:
                video[AdVideo.Field.name] = video_name

            video.remote_create()
            video_id = video.get_id()

            print(f"✅ Video uploaded! ID: {video_id}")
            return video_id

        except Exception as e:
            print(f"❌ Video upload error: {str(e)}")
            raise

    def create_video_ad_creative(
        self,
        name: str,
        video_id: str,
        title: str,
        body: str,
        link_url: str,
        call_to_action_type: str = "LEARN_MORE",
        page_id: str | None = None,
        thumbnail_hash: str | None = None,
    ) -> AdCreative:
        """
        Create an ad creative using a video.

        Args:
            name: Creative name
            video_id: Video ID (from upload_video)
            title: Ad headline
            body: Primary text
            link_url: Destination URL
            call_to_action_type: CTA type
            page_id: Facebook Page ID (optional, falls back to env)
            thumbnail_hash: Image hash for custom thumbnail (optional)

        Returns:
            AdCreative object
        """
        print(f"🎨 Creating video creative: {name}")

        try:
            page_id = page_id or os.getenv("META_PAGE_ID")

            video_data = {
                "video_id": video_id,
                "message": body,
                "title": title,
                "call_to_action": {
                    "type": call_to_action_type,
                    "value": {
                        "link": link_url,
                    },
                },
            }

            if thumbnail_hash:
                video_data["image_hash"] = thumbnail_hash

            object_story_spec = {
                "page_id": page_id,
                "video_data": video_data,
            }

            params = {
                AdCreative.Field.name: name,
                AdCreative.Field.object_story_spec: object_story_spec,
            }

            creative = self.ad_account.create_ad_creative(params=params)

            print(f"✅ Video creative created! ID: {creative.get_id()}")
            return creative

        except Exception as e:
            print(f"❌ Video creative error: {str(e)}")
            raise

    def create_complete_video_ad(
        self,
        campaign_name: str,
        ad_name: str,
        video_path: str,
        title: str,
        body: str,
        link_url: str,
        daily_budget_usd: float,
        targeting: dict,
        objective: str = "OUTCOME_AWARENESS",
        call_to_action: str = "LEARN_MORE",
        optimization_goal: str = "THRUPLAY",
        special_ad_categories: list | None = None,
    ) -> dict:
        """
        Create a complete video ad (campaign + ad set + creative + ad).

        Args:
            campaign_name: Campaign name
            ad_name: Ad name
            video_path: Local path to the video file
            title: Ad headline
            body: Primary text
            link_url: Destination URL
            daily_budget_usd: Daily budget in USD (converted to ILS via live rate)
            targeting: Audience targeting dict
            objective: Campaign objective (default OUTCOME_AWARENESS for video)
            call_to_action: CTA type
            optimization_goal: Ad set optimization (default THRUPLAY for video)
            special_ad_categories: Special categories list

        Returns:
            Dict with IDs of all created objects
        """
        print(f"\n🚀 Creating complete video ad: {campaign_name}")
        print("=" * 60)

        try:
            # 1. Upload video
            video_id = self.upload_video(video_path, video_name=ad_name)

            # 2. Create campaign
            campaign = self.create_campaign(
                name=campaign_name,
                objective=objective,
                status="PAUSED",
                special_ad_categories=special_ad_categories,
            )

            # 3. Create ad set
            ad_set = self.create_ad_set(
                campaign_id=campaign.get_id(),
                name=f"{ad_name} - Ad Set",
                daily_budget_usd=daily_budget_usd,
                targeting=targeting,
                optimization_goal=optimization_goal,
            )

            # 4. Extract thumbnail and upload
            print("🖼️ Extracting video thumbnail...")
            thumb_path = os.path.join(tempfile.gettempdir(), "ad_thumbnail.png")
            subprocess.run(
                [
                    "ffmpeg",
                    "-i",
                    video_path,
                    "-ss",
                    "00:00:02",
                    "-frames:v",
                    "1",
                    "-update",
                    "1",
                    thumb_path,
                    "-y",
                ],
                capture_output=True,
            )
            thumbnail_hash = self.upload_image(thumb_path, image_name=f"{ad_name} - Thumbnail")

            # 5. Create video creative
            creative = self.create_video_ad_creative(
                name=f"{ad_name} - Creative",
                video_id=video_id,
                title=title,
                body=body,
                link_url=link_url,
                call_to_action_type=call_to_action,
                thumbnail_hash=thumbnail_hash,
            )

            # 6. Create ad
            ad = self.create_ad(
                ad_set_id=ad_set.get_id(),
                creative_id=creative.get_id(),
                name=ad_name,
                status="PAUSED",
            )

            result = {
                "campaign_id": campaign.get_id(),
                "ad_set_id": ad_set.get_id(),
                "creative_id": creative.get_id(),
                "ad_id": ad.get_id(),
                "video_id": video_id,
                "thumbnail_hash": thumbnail_hash,
            }

            print("\n" + "=" * 60)
            print("✅ VIDEO AD CREATED SUCCESSFULLY!")
            print(f"📊 Campaign ID: {result['campaign_id']}")
            print(f"📊 Ad Set ID: {result['ad_set_id']}")
            print(f"📊 Creative ID: {result['creative_id']}")
            print(f"📊 Ad ID: {result['ad_id']}")
            print(f"📊 Video ID: {result['video_id']}")
            print("=" * 60)

            return result

        except Exception as e:
            print(f"\n❌ Error creating video ad: {str(e)}")
            raise

    def create_complete_ad(
        self,
        campaign_name: str,
        ad_name: str,
        image_path: str,
        title: str,
        body: str,
        link_url: str,
        daily_budget_usd: float,
        targeting: dict,
        objective: str = "OUTCOME_TRAFFIC",
        call_to_action: str = "LEARN_MORE",
        special_ad_categories: list | None = None,
    ) -> dict:
        """
        Create a complete ad (campaign + ad set + creative + ad).

        Args:
            campaign_name: Campaign name
            ad_name: Ad name
            image_path: Image path
            title: Ad headline
            body: Primary text
            link_url: Destination URL
            daily_budget_usd: Daily budget in USD (converted to ILS via live rate)
            targeting: Targeting dict
            objective: Campaign objective
            call_to_action: CTA type

        Returns:
            Dicionário com IDs de todos os objetos criados
        """
        print(f"\n🚀 Criando anúncio completo: {campaign_name}")
        print("=" * 60)

        try:
            # 1. Upload da imagem
            image_hash = self.upload_image(image_path)

            # 2. Criar campanha
            campaign = self.create_campaign(
                name=campaign_name,
                objective=objective,
                status="PAUSED",
                special_ad_categories=special_ad_categories,
            )

            # 3. Criar conjunto de anúncios
            ad_set = self.create_ad_set(
                campaign_id=campaign.get_id(),
                name=f"{ad_name} - Ad Set",
                daily_budget_usd=daily_budget_usd,
                targeting=targeting,
            )

            # 4. Criar criativo
            creative = self.create_ad_creative(
                name=f"{ad_name} - Creative",
                image_hash=image_hash,
                title=title,
                body=body,
                link_url=link_url,
                call_to_action_type=call_to_action,
            )

            # 5. Criar anúncio
            ad = self.create_ad(
                ad_set_id=ad_set.get_id(),
                creative_id=creative.get_id(),
                name=ad_name,
                status="PAUSED",
            )

            result = {
                "campaign_id": campaign.get_id(),
                "ad_set_id": ad_set.get_id(),
                "creative_id": creative.get_id(),
                "ad_id": ad.get_id(),
                "image_hash": image_hash,
            }

            print("\n" + "=" * 60)
            print("✅ ANÚNCIO COMPLETO CRIADO COM SUCESSO!")
            print(f"📊 Campaign ID: {result['campaign_id']}")
            print(f"📊 Ad Set ID: {result['ad_set_id']}")
            print(f"📊 Creative ID: {result['creative_id']}")
            print(f"📊 Ad ID: {result['ad_id']}")
            print("=" * 60)

            return result

        except Exception as e:
            print(f"\n❌ Erro ao criar anúncio completo: {str(e)}")
            raise


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv()

    manager = MetaAdsManager()

    targeting = {
        "geo_locations": {"countries": ["IL"]},
        "age_min": 25,
        "age_max": 55,
    }

    result = manager.create_complete_ad(
        campaign_name="Aiweon - Test Campaign",
        ad_name="Aiweon AI Marketing Ad",
        image_path="./generated_images/test_aiweon.png",
        title="AI-Powered Digital Marketing",
        body="Transform your marketing with AI. Aiweon delivers results.",
        link_url="https://aiweon.com",
        daily_budget_usd=14,  # ~50 ILS/day
        targeting=targeting,
    )

    print(f"\nResult: {result}")
