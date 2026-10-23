import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // A staged production build (`PI_WEB_DIST_DIR=.next-build npm run build`) and a
  // swapped-out build backup must not be linted as source.
  // demo/ is a separate Next.js project with its own lint config.
  { ignores: [".next*/**", "demo/**"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
