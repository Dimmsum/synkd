import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@whosfree/ui/lib/utils';
import { Slot } from 'radix-ui';

// Sizes keep a 44px minimum tap target on phones (NFR-UX-2) and tighten to the
// design's 40px/36px on larger screens.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/30',
        outline:
          'border border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        soft: 'bg-primary-soft text-primary-ink hover:bg-primary-soft/80',
        free: 'bg-status-free-soft text-status-free-ink hover:bg-status-free-soft/80',
        ghost: 'text-body-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary-ink underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4 has-[>svg]:px-3.5 md:h-10',
        sm: 'h-11 gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5 md:h-9',
        lg: 'h-12 px-6 text-base has-[>svg]:px-5',
        icon: 'size-11 md:size-10',
        'icon-sm': 'size-11 md:size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
