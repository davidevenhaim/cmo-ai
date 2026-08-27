from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.schemas.brand import BrandContext
from app.schemas.decisions import CmoRunResult
from app.schemas.content import (
    ContentGenerationRequest,
    GeneratedContent,
    ContentCriticRequest,
    CriticEvaluation,
)
from app.schemas.measurement import WeeklyInterpretation, WeeklyReviewRequest
from app.schemas.operator import (
    OperatorIntentProposal,
    OperatorIntentRequest,
    OperatorPrioritization,
    OperatorPrioritizeRequest,
)
from app.services.cmo_service import CmoService
from app.services.content_service import ContentService
from app.services.critic_service import CriticService
from app.services.measurement_service import MeasurementService
from app.services.operator_service import OperatorService

router = APIRouter(prefix="/brain")
_cmo_service = CmoService()
_content_service = ContentService()
_critic_service = CriticService()
_operator_service = OperatorService()
_measurement_service = MeasurementService()


class BrainRunRequest(BaseModel):
    context: BrandContext


@router.post("/run", response_model=CmoRunResult)
def run_brain(request: BrainRunRequest) -> CmoRunResult:
    try:
        return _cmo_service.run(request.context)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/content/generate", response_model=GeneratedContent)
def generate_content(request: ContentGenerationRequest) -> GeneratedContent:
    try:
        return _content_service.generate(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/content/critique", response_model=CriticEvaluation)
def critique_content(request: ContentCriticRequest) -> CriticEvaluation:
    try:
        return _critic_service.critique(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/operator/prioritize", response_model=OperatorPrioritization)
def prioritize_operator_actions(
    request: OperatorPrioritizeRequest,
) -> OperatorPrioritization:
    try:
        return _operator_service.prioritize(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/measurement/weekly-review", response_model=WeeklyInterpretation)
def interpret_weekly_review(request: WeeklyReviewRequest) -> WeeklyInterpretation:
    try:
        return _measurement_service.interpret_weekly(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/operator/intent", response_model=OperatorIntentProposal)
def classify_operator_intent(
    request: OperatorIntentRequest,
) -> OperatorIntentProposal:
    try:
        return _operator_service.classify_intent(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
