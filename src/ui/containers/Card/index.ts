/**
 * src/ui/containers/Card — the one surface container.
 *
 * `CardHeader` and `CardFooter` ARE exported, unlike DataTable's internals:
 * they are composition slots a consumer fills, not implementation detail. The
 * card renders whatever `header`/`footer` receives, so a page with a bespoke
 * header still gets the canonical frame.
 */

export {
  Card, CardHeader, CardFooter,
  type CardProps, type CardHeaderProps, type CardFooterProps,
  type CardVariant, type CardTone, type CardAccent, type CardDensity,
} from './Card';
