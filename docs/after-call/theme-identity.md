# Theme menu identity during hydration

The local Next 16.0.1 after-call proof emitted a Radix trigger-ID hydration error during full reloads. Removing the explicit trigger ID reproduces it. The closed menu has the same elements and attributes except its generated ID.

Temporary `useId` logging traced the first difference above `ModeToggle`, between the root provider and the nested `/app` provider. The root provider and its theme provider retain their IDs. The nested provider receives a different ancestor path on the client during the failed reload.

| Render point | Server | Client on failed reload |
| --- | --- | --- |
| Root provider | `_R_lb_` | `_R_lb_` |
| Root theme provider | `_R_llb_` | `_R_llb_` |
| `/app` provider | `_R_55rdllb_` | `_R_15rdllb_` |
| Nested theme provider | `_R_d5rdllb_` | `_R_35rdllb_` |
| Theme toggle | `_R_4pt5rdllb_` | `_R_16f5rdllb_` |
| Radix trigger | `radix-_R_cpt5rdllb_` | `radix-_R_36f5rdllb_` |

The route pathname and provider branches match on both sides. The outer theme provider has no parent theme context; the nested one sees three themes on both sides and returns its children through next-themes' existing-context branch. `ModeToggle` has no conditional children. The mismatch therefore comes from the streamed router's ancestor identity, rather than a different menu or theme-provider branch. The exact internal Next router cause is not established by this trace.

There is one theme menu in the `/app` shell. It keeps an explicit trigger ID and a matching popup label. The mounted hydration test uses different server/client ID prefixes to reproduce differing ancestor identities without changing the DOM. It asserts no console or recoverable hydration errors, then opens the menu and checks its accessible name. Removing the explicit ID makes that test fail. The full browser proof also rejects hydration console errors.
