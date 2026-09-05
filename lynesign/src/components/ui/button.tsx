import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-btn border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--background)] active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // navy background + white text
        default: "bg-navy text-white hover:bg-navy-dark",
        // tan background + NAVY text — never text-white (tan+white fails WCAG AA)
        accent: "bg-tan text-navy hover:bg-tan-hover",
        // hairline border, surface fill
        outline: "border-hairline bg-surface text-ink hover:bg-canvas",
        ghost: "text-ink hover:bg-canvas",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        link: "text-navy underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 gap-1.5 rounded-btn px-3 text-xs",
        default: "h-9 gap-2 px-4",
        lg: "h-10 gap-2 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
