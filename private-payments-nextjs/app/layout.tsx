import type { ReactNode } from "react";
import { UmbraSessionProvider } from "./providers";
import "./globals.css";

export const metadata = {
  title: "private-payments-app-test",
  description: "Private payments on Solana, powered by Umbra.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UmbraSessionProvider>
          <div className="container">{children}</div>
        </UmbraSessionProvider>
      </body>
    </html>
  );
}
