using UnrealBuildTool;

public class Wonderland : ModuleRules
{
	public Wonderland(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		// EXCEPTIONS ON, BECAUSE THIS MODULE ALREADY DEPENDS ON THEM.
		//
		// WonderlandWireDecode parses numbers with std::stod inside a try/catch, deliberately: that decoder is built
		// with no engine dependency so the code which ships is the code the offline harness runs under sanitizers
		// (see the Json note below). std::stod reports overflow by throwing, and there is no other way to ask it.
		//
		// WHY NOBODY HIT THIS. UnrealBuildTool enables exceptions for EDITOR builds and not for game builds, so the
		// editor compiled that try/catch happily while the game target failed on it with C4530 -- and the editor is
		// what a person has open. Every game-target compile-check of this module died in the unity file holding
		// WonderlandWireDecode.cpp, before ever reaching the file actually being checked. Setting it here makes the
		// two targets agree instead of leaving the module compilable in only one of them.
		bEnableExceptions = true;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			// The Relay Bridge sync layer. HTTP only — Wonderland speaks to
			// Relay exclusively through the Bridge's explicit read contract.
			"HTTP",
			// KEPT, and NOT what decodes Relay's payloads. `WonderlandWireDecode`
			// parses its own JSON — strictly, and with no engine dependency — so
			// that the code which ships is the code the offline harness runs at
			// -O0 and -O2 with sanitizers. A decoder built on FJsonObjectConverter
			// could not be executed in the environment that wrote it, and would
			// have shipped unproven; it would also map by NAME, which is the one
			// thing this seam cannot do — see WONDERLAND_WIRE_CONTRACT.md.
			//
			// These stay for anything else in the module that wants JSON.
			"Json",
			"JsonUtilities",
			"DeveloperSettings",
			// World UI (built from the Figma system).
			"UMG",
			"Slate",
			"SlateCore"
		});

		// THE REAL WEB, when Wonder Web is asked for it (founder, 2026-09-17: "soon it should not be a simulation should be
		// real"). NOT the engine's own browser: this install ships CEF's libraries but not UnrealCEFSubProcess.exe, so
		// SWebBrowser renders an empty page and logs nothing. Instead a real browser renders the page in the Julius Connect
		// runtime and Wonderland draws its frames -- which is what ImageWrapper is for: decoding them
		// (WonderlandWonderWebLive.h). It loads nothing until real mode is switched on, and only hosts on the allowlist.
		PrivateDependencyModuleNames.Add("ImageWrapper");
		// R16 REAL VOICE (founder, 10-04: EOS Voice): EOSShared's SDK manager makes the platform from the founder's file at run time,
		// EOSVoiceChat joins the room the authority minted (WonderlandEosVoice.cpp). Nothing of the product's ids is in an .ini.
		PrivateDependencyModuleNames.AddRange(new string[] { "EOSShared", "EOSSDK", "VoiceChat", "EOSVoiceChat" });

		// FImageCore::ResizeTo, for the HUD test library's scaled film frames (UWonderlandHudTestLibrary::CaptureViewportJpeg).
		// FImageView and FImageUtils come through Engine; the resize itself lives in ImageCore and does not.
		PrivateDependencyModuleNames.Add("ImageCore");

		// GNumDrawCallsRHI / GNumPrimitivesDrawnRHI, for the Project Avatar cost measurement. The founder asked for
		// draw calls beside the thread times, and those counters are declared in RHI rather than reachable through
		// Engine -- without this the link fails on two unresolved externals and the numbers simply cannot be read.
		PrivateDependencyModuleNames.Add("RHI");
		// Real geometry for the living brain and its python. The founder's words: "organic, polished, realistic,
		// not Roblox/blocky" -- which instanced cubes cannot be, however many of them there are.
		PublicDependencyModuleNames.Add("ProceduralMeshComponent");

		// UNavigationInvokerComponent, for the Relay Dog. Wonderland is a 1,478 m disc and shipped with NO
		// navigation data at all -- find_path_to_location_synchronously returned nothing over 400 m, so nothing
		// could be ROUTED across the level even though a player walks it fine. Generating around an invoker
		// gives routable navigation where the player is, without baking 2.5 km of it.
		PublicDependencyModuleNames.Add("NavigationSystem");


		if (Target.bBuildEditor)
		{
			// Editor-only test hooks (WonderlandUiTestLibrary::SetBackgroundThrottleSuspended).
			PrivateDependencyModuleNames.Add("UnrealEd");
		}
	}
}
