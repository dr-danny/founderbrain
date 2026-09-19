/**
 * FounderBrain F-mark. Same lockup as the Marketplace listing: cream F, mint bar, ink ground.
 */
export function BrandMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      className={className}
      src="/founderbrain-mark.svg"
      width={size}
      height={size}
      alt=""
      decoding="async"
    />
  );
}
