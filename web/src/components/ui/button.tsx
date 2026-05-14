import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Base — adds: transition-all (so shadow + color + transform animate
  // together), active press for tactile feedback, and tighter focus ring.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Default CTA — auto-inverting "ink" button. Dark mode = white
        // surface with deep-black text; light mode = warm-near-black with
        // off-white text. The brand orange has moved to the cards (neon
        // ring / letterpress hairline), so the CTA itself is pure contrast.
        // Halo color matches the surface tone — warm-brown shadow in light,
        // white shadow in dark.
        default: [
          "bg-foreground text-background",
          "shadow-[0_4px_18px_-3px_rgb(28_22_17_/_0.22)]",
          "hover:bg-foreground/90 hover:shadow-[0_10px_30px_-4px_rgb(28_22_17_/_0.32)]",
          "dark:shadow-[0_4px_18px_-2px_rgb(255_255_255_/_0.10)]",
          "dark:hover:shadow-[0_8px_28px_-4px_rgb(255_255_255_/_0.22)]",
        ].join(" "),
        // Brand variant — explicit orange CTA when you DO want the brand
        // color to do the talking (e.g. "אשר" on approval detail, "התחבר
        // ל-Meta"). Reach for this when the action carries Aiweon-specific
        // semantics; default ("ink") for everything else.
        brand: [
          "bg-primary text-primary-foreground",
          "shadow-[0_4px_18px_-2px_rgb(245_132_31_/_0.35)]",
          "hover:bg-primary/95 hover:shadow-[0_8px_28px_-2px_rgb(245_132_31_/_0.55)]",
          "dark:text-[#0a0a0a]",
        ].join(" "),
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_4px_18px_-2px_rgb(220_38_38_/_0.35)] hover:bg-destructive/95 hover:shadow-[0_8px_28px_-2px_rgb(220_38_38_/_0.5)]",
        // Outline — quiet at rest, warm on hover. Border lifts toward brand
        // orange, background gets a faint orange wash. Light mode wash is
        // stronger (12%) so it reads on cream paper; dark mode lighter
        // (10%) since the neon-ring page already carries orange. Hover
        // adds a soft warm halo so the button visibly "lifts".
        outline: [
          "border border-input bg-transparent text-foreground",
          "hover:border-brand-500/45 hover:bg-brand-500/[0.12] hover:text-foreground",
          "hover:shadow-[0_6px_20px_-6px_rgb(245_132_31_/_0.22)]",
          "dark:hover:bg-brand-500/[0.10]",
          "dark:hover:shadow-[0_6px_20px_-6px_rgb(245_132_31_/_0.30)]",
        ].join(" "),
        // Secondary — soft surface, slight lift on hover.
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70 hover:shadow-[0_2px_10px_-1px_rgb(0_0_0_/_0.15)]",
        // Ghost — invisible until hover, then a calm wash. Used for
        // toolbar pills and nav-like actions.
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-white/[0.05]",
        // Link — text with a brand underline that grows in.
        link: "text-primary underline-offset-[6px] decoration-brand-500/0 hover:decoration-brand-500/80 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3.5",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
