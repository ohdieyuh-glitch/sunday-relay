using UnrealBuildTool;

public class Wonderland : ModuleRules
{
	public Wonderland(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

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

		if (Target.bBuildEditor)
		{
			// Editor-only test hooks (WonderlandUiTestLibrary::SetBackgroundThrottleSuspended).
			PrivateDependencyModuleNames.Add("UnrealEd");
		}
	}
}
