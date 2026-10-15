import "@testing-library/jest-dom";
import { configureAxe } from "jest-axe";

// Set env vars expected by the claim page and network context
process.env.NEXT_PUBLIC_AIRDROP_CONTRACT_ID = "CTEST_CONTRACT_ID_FOR_TESTING";
process.env.NEXT_PUBLIC_NETWORK = "testnet";

// Configure axe with reasonable defaults for this dark-theme app
configureAxe({
  rules: {
    // We explicitly set color contrast in CSS; allow axe to check it
    "color-contrast": { enabled: true },
  },
});
