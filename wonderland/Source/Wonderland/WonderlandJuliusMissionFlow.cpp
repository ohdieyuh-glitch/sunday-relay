#include "WonderlandJuliusMissionFlow.h"

namespace WonderlandJuliusMissionFlow
{
	using WonderlandJuliusMissionLogic::EMissionProgress;
	using WonderlandJuliusMissionLogic::ProgressDisplayLabel;

	namespace
	{

		bool MissionFlowPastDispatched(EMissionProgress Meaning)
		{
			switch (Meaning)
			{
			case EMissionProgress::Dispatched:
			case EMissionProgress::Running:
			case EMissionProgress::Paused:
			case EMissionProgress::Succeeded:
			case EMissionProgress::Failed:
				return true;
			default:
				return false;
			}
		}

		FProgressPanel MissionFlowCeiling()
		{
			FProgressPanel Out;
			Out.Panel = EFlowPanel::Progress;
			Out.Line = ProgressDisplayLabel(EMissionProgress::OperatorStarted);
			Out.bFinished = false;
			Out.bPaid = false;
			Out.bHeldAtDispatched = true;
			return Out;
		}
	}

	FProgressPanel PanelForProgress(EMissionProgress Meaning)
	{
		if (MissionFlowPastDispatched(Meaning))
		{
			return MissionFlowCeiling();
		}
		FProgressPanel Out;
		Out.Panel = EFlowPanel::Progress;
		Out.bFinished = false;
		Out.Line = ProgressDisplayLabel(Meaning);
		switch (Meaning)
		{
		case EMissionProgress::Waiting:
			Out.bFinished = false; // FLOW_UNKNOWN_NOT_FINISHED
			break;
		case EMissionProgress::NotStarted:
			Out.Line = ProgressDisplayLabel(EMissionProgress::NotStarted); // FLOW_EXPIRED_SHOWS_NOT_STARTED
			Out.bNotStarted = true;
			Out.bFinished = false;
			break;
		case EMissionProgress::OperatorStarted:
			Out.bPaid = true;
			Out.bHeldAtDispatched = true;
			break;
		case EMissionProgress::DispatchUnconfirmed:
			Out.bUnconfirmed = true;
			Out.bPaid = false;
			break;
		default:
			break;
		}
		return Out;
	}

	FProgressPanel PanelForStatusRouteWord(std::string_view Word)
	{
		FProgressPanel Out;
		Out.Panel = EFlowPanel::Progress;
		Out.bFinished = false;
		if (Word == "running" || Word == "completed")
		{
			Out = MissionFlowCeiling();
			Out.bFault = true;
			Out.bPaid = false;
			Out.bFinished = false;
			return Out;
		}
		Out.Line = ProgressDisplayLabel(EMissionProgress::Waiting);
		return Out;
	}

	FProgressPanel PanelForWrapperToken(std::string_view Token)
	{
		if (Token == "running" || Token == "completed")
		{
			return PanelForStatusRouteWord(Token);
		}
		if (Token == "operator_started") { return PanelForProgress(EMissionProgress::OperatorStarted); }
		if (Token == "dispatch_unconfirmed") { return PanelForProgress(EMissionProgress::DispatchUnconfirmed); }
		if (Token == "not_started") { return PanelForProgress(EMissionProgress::NotStarted); }
		if (Token == "admitted_waiting") { return PanelForProgress(EMissionProgress::AdmittedHeld); }
		if (Token == "dispatching") { return PanelForProgress(EMissionProgress::AwaitingDispatchAnswer); }
		if (Token == "refused") { return PanelForProgress(EMissionProgress::Refused); }
		FProgressPanel Out;
		Out.Panel = EFlowPanel::Progress;
		Out.bFinished = false;
		Out.bUsesWrapperLabel = true;
		return Out;
	}

	FResultPanel ResultPanelFor(const FResultRead& Read)
	{
		FResultPanel Out;
		Out.Panel = EFlowPanel::Result;
		if (!Read.bReported)
		{
			Out.Line = CopyNoResultYet;
			return Out;
		}
		Out.bReported = true;
		if (!Read.bVerified)
		{
			Out.Line = CopyVerifiedFalse;
			return Out;
		}
		Out.bVerified = true;
		Out.bShowsArtifact = true;
		Out.Line = CopyVerifiedTrue;
		return Out;
	}

	void FMissionFlow::SetOffers(std::vector<FMissionOffer> InOffers)
	{
		OfferList = std::move(InOffers);
	}

	void FMissionFlow::InteractWithTerminal()
	{
		if (Step == EFlowStep::AtTerminal) { Step = EFlowStep::Choosing; }
	}

	bool FMissionFlow::ChooseMission(std::string_view MissionId)
	{
		if (Step != EFlowStep::Choosing && Step != EFlowStep::Confirming) { return false; }
		for (const FMissionOffer& Offer : OfferList)
		{
			if (Offer.Id == MissionId)
			{
				ChosenId.assign(MissionId.data(), MissionId.size());
				Step = EFlowStep::Confirming;
				return true;
			}
		}
		return false;
	}

	void FMissionFlow::BackToChoice()
	{
		if (Step == EFlowStep::Confirming)
		{
			Step = EFlowStep::Choosing;
		}
	}

	FDispatchIntent FMissionFlow::Confirm() const
	{
		FDispatchIntent Intent;
		if (Step != EFlowStep::Confirming || ChosenId.empty() || bDispatchHanded) { return Intent; }
		Intent.bSend = true;
		Intent.MissionId = ChosenId;
		return Intent;
	}

	void FMissionFlow::NoteDispatchHandedToWrapper(bool bAccepted)
	{
		if (!bAccepted || Step != EFlowStep::Confirming || ChosenId.empty() || bDispatchHanded) { return; }
		bDispatchHanded = true;
		Step = EFlowStep::Watching;
	}

	void FMissionFlow::NoteClientRunId(std::string_view WljRunId)
	{
		if (!WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId))
		{
			return;
		}
		ClientRunId.assign(WljRunId.data(), WljRunId.size());
		bRunIdOk = true;
	}

	void FMissionFlow::NoteProgress(EMissionProgress Next)
	{
		Meaning = Next;
		bHaveMeaning = true;
	}

	void FMissionFlow::NoteStatusRouteWord(std::string_view Word)
	{
		StatusWord.assign(Word.data(), Word.size());
		bHaveWord = true;
	}

	void FMissionFlow::NoteWrapperToken(std::string_view Token)
	{
		WrapperToken.assign(Token.data(), Token.size());
		bHaveToken = true;
	}

	void FMissionFlow::NoteResult(const IMissionResultReader& Reader)
	{
		if (!bRunIdOk)
		{
			Result = ResultPanelFor(FResultRead{});
			return;
		}
		Result = ResultPanelFor(Reader.Read(ClientRunId));
	}

	FFlowView FMissionFlow::View() const
	{
		FFlowView Out;
		Out.Step = Step;
		Out.bShowChoice = Step == EFlowStep::Choosing || Step == EFlowStep::Confirming;
		Out.bShowConfirm = Step == EFlowStep::Confirming;
		Out.bShowProgress = Step == EFlowStep::Watching;
		Out.bShowResult = Step == EFlowStep::Watching;
		Out.MissionId = ChosenId;
		Out.ClientRunId = ClientRunId;
		Out.bRunIdOk = bRunIdOk;
		Out.bDispatchHanded = bDispatchHanded;
		Out.Result = bRunIdOk ? Result : ResultPanelFor(FResultRead{});
		if (!Out.bShowProgress) { return Out; }

		if (bHaveWord && (StatusWord == "running" || StatusWord == "completed"))
		{
			Out.Progress = PanelForStatusRouteWord(StatusWord);
			return Out;
		}
		if (bHaveMeaning)
		{
			Out.Progress = PanelForProgress(Meaning);
			return Out;
		}
		if (bHaveToken)
		{
			Out.Progress = PanelForWrapperToken(WrapperToken);
			return Out;
		}
		if (bHaveWord)
		{
			Out.Progress = PanelForStatusRouteWord(StatusWord);
			return Out;
		}
		Out.Progress = PanelForProgress(EMissionProgress::Waiting);
		return Out;
	}
}
