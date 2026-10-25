// WONDERLAND -- production 16-byte source for the J1 wrapper.
//
// The only call is IPlatformCrypto::Get().CreateContext()->CreateRandomBytes.
// Success is EPlatformCryptoResult::Success. Anything else, including a missing
// module, returns false. There is no fallback: not CreatePseudoRandomBytes, not
// RAND_bytes, not FGuid, not FMath.
//
// Compiled and run in UE 5.8.2 Win64 (#433, #456): CreateContext() returns
// TUniquePtr<FEncryptionContext> and CreateRandomBytes takes TArrayView<uint8>.

#pragma once

#include "Wonderland/WonderlandJuliusMissionLogic.h"

class FWonderlandJuliusPlatformCryptoRandom final : public WonderlandJuliusMissionLogic::IRandomBytes16
{
public:
	bool Fill(std::uint8_t (&OutBytes)[16]) override;
};
