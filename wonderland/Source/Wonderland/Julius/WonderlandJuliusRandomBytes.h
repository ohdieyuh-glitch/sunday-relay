// WONDERLAND -- production 16-byte source for the J1 wrapper.
//
// The only call is IPlatformCrypto::Get().CreateContext()->CreateRandomBytes.
// Success is EPlatformCryptoResult::Success. Anything else, including a missing
// module, returns false. There is no fallback: not CreatePseudoRandomBytes, not
// RAND_bytes, not FGuid, not FMath.
//
// NOT COMPILED HERE. No Unreal Engine binary is available in this environment.
// An Unreal build has to confirm that CreateContext() returns
// TUniquePtr<FEncryptionContext> and that CreateRandomBytes takes TArrayView<uint8>
// (Engine/Plugins/Experimental/PlatformCrypto, the shape documented for 5.4/5.7).

#pragma once

#include "WonderlandJuliusMissionLogic.h"

class FWonderlandJuliusPlatformCryptoRandom final : public WonderlandJuliusMissionLogic::IRandomBytes16
{
public:
	bool Fill(std::uint8_t (&OutBytes)[16]) override;
};
