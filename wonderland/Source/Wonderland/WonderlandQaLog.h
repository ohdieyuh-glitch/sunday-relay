// Re-exports the engine-free QA event line. Emitting it is the caller's UE_LOG of the
// returned string (LogTemp, Display). This header stays free of the engine so a
// standalone syntax check can parse it.
#pragma once

#include "WonderlandQaFormat.h"

extern const char WonderlandQaLogBuild[];
