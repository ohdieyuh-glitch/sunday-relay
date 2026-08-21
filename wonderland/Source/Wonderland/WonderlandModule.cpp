// Wonderland — the multiplayer open-world layer of Relay.
// Unreal renders. Relay decides.

#include "Modules/ModuleManager.h"

#include "WonderlandWorldProof.h"

// A REAL MODULE IMPL RATHER THAN FDefaultGameModuleImpl, for one reason: the
// world proof has to be registered before any world begins play, and startup is
// the only place that is guaranteed. It logs which world actually loaded and how
// many actors it holds — the fact that was missing when a healthy live stream
// showed an almost-empty template instead of the built Wonderland.
class FWonderlandModule : public FDefaultGameModuleImpl
{
public:
	virtual void StartupModule() override
	{
		FDefaultGameModuleImpl::StartupModule();
		WonderlandWorldProof::Register();
	}

	virtual void ShutdownModule() override
	{
		WonderlandWorldProof::Unregister();
		FDefaultGameModuleImpl::ShutdownModule();
	}
};

IMPLEMENT_PRIMARY_GAME_MODULE(FWonderlandModule, Wonderland, "Wonderland");
