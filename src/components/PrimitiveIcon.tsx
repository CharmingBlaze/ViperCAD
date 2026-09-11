import type { ReactNode } from 'react';
import type { PrimitiveKind } from '@/core/primitives/PrimitiveFactory';

type Props = {
  kind: PrimitiveKind;
  size?: number;
};

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function BoxIcon() {
  return (
    <>
      <path d="M12 3.6 20.2 8v8L12 20.4 3.8 16V8Z" />
      <path d="M12 20.4V12" />
      <path d="M3.8 8 12 12l8.2-4" />
    </>
  );
}

function PlaneIcon() {
  return (
    <>
      <path d="M4 13.2 12 8.4l8 4.8-8 4.8Z" />
      <path d="M12 8.4v9.6" />
    </>
  );
}

function CylinderIcon() {
  return (
    <>
      <ellipse cx="12" cy="6.4" rx="6.4" ry="2.5" />
      <path d="M5.6 6.4v10.8" />
      <path d="M18.4 6.4v10.8" />
      <path d="M5.6 17.2c0 1.4 2.9 2.5 6.4 2.5s6.4-1.1 6.4-2.5" />
    </>
  );
}

function ConeIcon() {
  return (
    <>
      <path d="M12 3.4 18.6 16.6" />
      <path d="M12 3.4 5.4 16.6" />
      <ellipse cx="12" cy="17.2" rx="6.6" ry="2.4" />
    </>
  );
}

function PyramidIcon() {
  return (
    <>
      <path d="M12 3.5 4.2 17.4 13.6 20.2 19.8 13.2Z" />
      <path d="M12 3.5 13.6 20.2" />
    </>
  );
}

function SphereIcon() {
  return (
    <>
      <circle cx="12" cy="12" r="8" />
      <ellipse cx="12" cy="12" rx="8" ry="3" />
      <path d="M12 4c2.6 2.8 2.6 13.2 0 16" />
    </>
  );
}

function IcosphereIcon() {
  return (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4 18.4 8.2v7.6L12 20 5.6 15.8V8.2Z" />
      <path d="M5.6 8.2 12 12l6.4-3.8" />
      <path d="M12 12v8" />
    </>
  );
}

function CapsuleIcon() {
  return (
    <>
      <path d="M8.2 8.2a3.8 3.8 0 0 1 7.6 0v7.6a3.8 3.8 0 0 1-7.6 0Z" />
      <ellipse cx="12" cy="8.2" rx="3.8" ry="1.5" />
    </>
  );
}

function RampIcon() {
  return (
    <>
      <path d="M4.2 16.6 12 5.8l8 3.8v8.4L12 20.4Z" />
      <path d="M12 5.8v14.6" />
      <path d="M4.2 16.6 12 20.4" />
    </>
  );
}

function StairsIcon() {
  return (
    <>
      <path d="M4.6 18.8V15.2h3.8V11.6h3.8V8h7.2v10.8Z" />
      <path d="M8.4 15.2v3.6" />
      <path d="M12.2 11.6v7.2" />
    </>
  );
}

function TorusIcon() {
  return (
    <>
      <ellipse cx="12" cy="13" rx="8.1" ry="4.8" />
      <ellipse cx="12" cy="13" rx="3.5" ry="2" />
      <path d="M4.2 13c1.4-2.2 4.4-3.6 7.8-3.6" />
    </>
  );
}

function ArchIcon() {
  return (
    <>
      <path d="M5.2 19.2V12a6.8 6.8 0 0 1 13.6 0v7.2" />
      <path d="M8.6 19.2v-6.4a3.4 3.4 0 0 1 6.8 0v6.4" />
      <path d="M5.2 19.2h3.4" />
      <path d="M15.4 19.2h3.4" />
    </>
  );
}

function TubeIcon() {
  return (
    <>
      <ellipse cx="12" cy="6.6" rx="6.2" ry="2.4" />
      <ellipse cx="12" cy="6.6" rx="3" ry="1.15" />
      <path d="M5.8 6.6v10.4" />
      <path d="M18.2 6.6v10.4" />
      <path d="M5.8 17c0 1.3 2.8 2.4 6.2 2.4s6.2-1.1 6.2-2.4" />
      <path d="M9 16.7c.8.4 1.8.6 3 .6s2.2-.2 3-.6" />
    </>
  );
}

function CircleIcon() {
  return (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" opacity="0.35" />
    </>
  );
}

function RingIcon() {
  return (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4.2" />
    </>
  );
}

function PolygonIcon() {
  return <path d="M12 3.8l7.1 4.1v8.2L12 20.2l-7.1-4.1V7.9Z" />;
}

function StarIcon() {
  return (
    <path d="M12 3.5l2.6 5.3 5.9.8-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.8Z" />
  );
}

function PrismIcon() {
  return (
    <>
      <path d="M12 3.6l6 3.4v10l-6 3.4-6-3.4v-10Z" />
      <path d="M12 3.6v16.8" />
      <path d="M6 7l6 3.4 6-3.4" />
    </>
  );
}

function WedgeIcon() {
  return (
    <>
      <path d="M4.5 18.5 12 7.5l7.5 4v7L12 20.5Z" />
      <path d="M12 7.5v13" />
      <path d="M4.5 18.5 12 20.5" />
    </>
  );
}

function OctahedronIcon() {
  return (
    <>
      <path d="M12 3 19.5 12 12 21 4.5 12Z" />
      <path d="M4.5 12h15" />
      <path d="M12 3v18" opacity="0.35" />
    </>
  );
}

const ICONS: Record<PrimitiveKind, () => ReactNode> = {
  box: BoxIcon,
  plane: PlaneIcon,
  cylinder: CylinderIcon,
  cone: ConeIcon,
  pyramid: PyramidIcon,
  sphere: SphereIcon,
  icosphere: IcosphereIcon,
  capsule: CapsuleIcon,
  ramp: RampIcon,
  stairs: StairsIcon,
  arch: ArchIcon,
  torus: TorusIcon,
  tube: TubeIcon,
  circle: CircleIcon,
  ring: RingIcon,
  polygon: PolygonIcon,
  star: StarIcon,
  prism: PrismIcon,
  wedge: WedgeIcon,
  octahedron: OctahedronIcon,
};

export function PrimitiveIcon({ kind, size = 19 }: Props) {
  const Glyph = ICONS[kind];
  return (
    <svg
      className="primitive-icon"
      width={size}
      height={size}
      {...svgProps}
    >
      <Glyph />
    </svg>
  );
}
