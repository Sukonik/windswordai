import demo from "@/fixtures/demo.json";

export const demoWorkspace = demo;
export const isDemoMode =
  process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
