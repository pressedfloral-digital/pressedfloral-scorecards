"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const MOBILE_BREAKPOINT = 768;

type SidebarContextValue = {
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}

export function SidebarProvider({
  children,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const [isMobile, setIsMobile] = React.useState(false);
  const [openMobile, setOpenMobile] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const value = React.useMemo(
    () => ({ isMobile, openMobile, setOpenMobile }),
    [isMobile, openMobile]
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-mobile": SIDEBAR_WIDTH_MOBILE,
            ...style,
          } as React.CSSProperties
        }
        className={cn("flex min-h-svh w-full bg-background", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          side="left"
          className="w-(--sidebar-width-mobile) bg-sidebar p-0 text-sidebar-foreground"
        >
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      className={cn(
        "sticky top-0 hidden h-svh w-(--sidebar-width) shrink-0 md:flex",
        className
      )}
    >
      <div
        className={cn(
          "flex h-full w-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

export function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { setOpenMobile, openMobile } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8 md:hidden", className)}
      onClick={(event) => {
        onClick?.(event);
        setOpenMobile(!openMobile);
      }}
      {...props}
    >
      <PanelLeft />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

export function SidebarInset({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  // Intentionally a <div>, not <main>: the app's content already renders its own
  // semantic <main> (with the centered max-width content column). Using <main> here
  // would (a) create two <main> landmarks and (b) let the legacy `main { max-width }`
  // rule cap and pad the whole shell, including the header.
  return (
    <div
      className={cn(
        "flex min-h-svh w-full flex-1 flex-col bg-background",
        className
      )}
      {...props}
    />
  );
}

export function SidebarHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-2 px-2.5 py-2.5", className)}
      {...props}
    />
  );
}

export function SidebarContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-1.5", className)}
      {...props}
    />
  );
}

export function SidebarFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 p-2", className)}
      {...props}
    />
  );
}

export function SidebarGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-0.5 px-1 py-1", className)} {...props} />;
}

export function SidebarGroupLabel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export function SidebarGroupContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-0.5", className)} {...props} />;
}

export function SidebarMenu({
  className,
  ...props
}: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("flex flex-col gap-0.5", className)} {...props} />;
}

export function SidebarMenuItem({
  className,
  ...props
}: React.HTMLAttributes<HTMLLIElement>) {
  return <li className={cn("relative", className)} {...props} />;
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2.5 overflow-hidden rounded-md px-2 py-1.5 text-left text-[13.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      isActive: {
        true: "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        false: "text-sidebar-foreground hover:bg-[var(--surface2)] hover:text-foreground",
      },
    },
    defaultVariants: { isActive: false },
  }
);

interface SidebarMenuButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof sidebarMenuButtonVariants> {
  asChild?: boolean;
}

export const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  SidebarMenuButtonProps
>(({ className, isActive, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ isActive, className }))}
      {...props}
    />
  );
});
SidebarMenuButton.displayName = "SidebarMenuButton";

export function SidebarMenuBadge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground",
        className
      )}
      {...props}
    />
  );
}
