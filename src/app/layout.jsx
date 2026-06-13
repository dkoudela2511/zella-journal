import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Zella Journal",
  description: "Trading journal — deník, analytika, disciplína.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="cs">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
