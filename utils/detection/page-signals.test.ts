// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  collectPageSignals,
  coverFromDocument,
  seriesUrlFrom,
} from "./page-signals";

const URL_UNDER_TEST = "https://example.com/one-piece/capitulo/1100";

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.title = "";
});

describe("collectPageSignals", () => {
  it("collects every available signal", () => {
    document.head.innerHTML = `
      <meta property="og:title" content="OG title" />
      <meta name="twitter:title" content="Twitter title" />
      <meta property="og:site_name" content="Example Scan" />
    `;
    document.title = "Doc title";
    document.body.innerHTML = `
      <h1>Heading title</h1>
      <a href="https://example.com/one-piece/">One Piece</a>
    `;

    expect(collectPageSignals(document, URL_UNDER_TEST)).toEqual({
      url: URL_UNDER_TEST,
      documentTitle: "Doc title",
      ogTitle: "OG title",
      twitterTitle: "Twitter title",
      firstHeading: "Heading title",
      siteName: "Example Scan",
      seriesLinkTitle: "One Piece",
      seriesLinkHinted: false,
      seriesLinkSlug: "one-piece",
      themeHeading: null,
      themeReader: false,
    });
  });

  it("reads the heading the theme points at, and says the theme matched", () => {
    document.body.innerHTML = `
      <h1>Logo del sitio</h1>
      <h1 id="chapter-heading">Soy un Dios Maligno - Capítulo 567</h1>
    `;

    const signals = collectPageSignals(document, URL_UNDER_TEST, {
      reader: true,
      headingSelector: "#chapter-heading",
      seriesLinkSelector: null,
    });

    expect(signals.themeHeading).toBe("Soy un Dios Maligno - Capítulo 567");
    expect(signals.themeReader).toBe(true);
  });

  it("treats a heading selector the browser cannot parse as no hint", () => {
    const signals = collectPageSignals(document, URL_UNDER_TEST, {
      reader: false,
      headingSelector: ":::",
      seriesLinkSelector: ":::",
    });

    expect(signals.themeHeading).toBeNull();
    expect(signals.seriesLinkTitle).toBeNull();
  });

  it("returns null for missing or empty signals", () => {
    document.head.innerHTML = '<meta property="og:title" content="   " />';
    document.body.innerHTML = "<h1>   </h1><h1>Second heading</h1>";

    const signals = collectPageSignals(document, URL_UNDER_TEST);

    expect(signals.ogTitle).toBeNull();
    expect(signals.twitterTitle).toBeNull();
    expect(signals.firstHeading).toBe("Second heading");
    expect(signals.siteName).toBeNull();
    expect(signals.seriesLinkTitle).toBeNull();
  });
});

describe("series link signal", () => {
  const CHAPTER_URL =
    "https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-89-pack/";

  it("finds the breadcrumb anchor whose href prefixes the chapter path", () => {
    document.body.innerHTML = `
      <ol>
        <li><a href="https://mhscans.com/">Home</a></li>
        <li><a href="https://mhscans.com/manga/">All Mangas</a></li>
        <li>
          <a href="https://mhscans.com/series/espadachin-a-tiempo-completo/">
            Espadachín a Tiempo Completo
          </a>
        </li>
      </ol>
      <a href="https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-88/">
        Capítulo 88
      </a>
    `;

    expect(collectPageSignals(document, CHAPTER_URL).seriesLinkTitle).toBe(
      "Espadachín a Tiempo Completo",
    );
  });

  it("resolves relative hrefs against the page url", () => {
    document.body.innerHTML =
      '<a href="/series/espadachin-a-tiempo-completo/">Espadachín a Tiempo Completo</a>';

    expect(collectPageSignals(document, CHAPTER_URL).seriesLinkTitle).toBe(
      "Espadachín a Tiempo Completo",
    );
  });

  it("rejects anchors whose text does not round-trip against their slug", () => {
    document.body.innerHTML =
      '<a href="/series/espadachin-a-tiempo-completo/">Ver todos los capítulos</a>';

    expect(
      collectPageSignals(document, CHAPTER_URL).seriesLinkTitle,
    ).toBeNull();
  });

  it("ignores cross-origin anchors", () => {
    document.body.innerHTML =
      '<a href="https://other.com/series/espadachin-a-tiempo-completo/">Espadachín a Tiempo Completo</a>';

    expect(
      collectPageSignals(document, CHAPTER_URL).seriesLinkTitle,
    ).toBeNull();
  });
});

describe("sibling series link (no series in the chapter url)", () => {
  // heavenmanga, measured: the reader lives at /manga/leer/<id>, the series at
  // /manga/<slug>, and the page title is the only thing tying the two.
  const CHAPTER_URL = "https://heavenmanga.com/manga/leer/293702";
  const TITLE =
    "Leer Soy un Dios Maligno Capitulo 567 Español: Pagina 1 - HeavenManga ";

  it("takes the link to the series the page title names", () => {
    document.title = TITLE;
    document.body.innerHTML = `
      <a href="https://heavenmanga.com/">HeavenManga</a>
      <a href="https://heavenmanga.com/manga/soy-un-dios-maligno">Soy un Dios Maligno</a>
      <a href="https://heavenmanga.com/manga/leer/293703">Siguiente</a>
    `;

    const signals = collectPageSignals(document, CHAPTER_URL);

    expect(signals.seriesLinkTitle).toBe("Soy un Dios Maligno");
    expect(signals.seriesLinkSlug).toBe("soy-un-dios-maligno");
    expect(seriesUrlFrom(document, CHAPTER_URL)).toBe(
      "https://heavenmanga.com/manga/soy-un-dios-maligno/",
    );
  });

  it("ignores the other series a sidebar links to", () => {
    document.title = TITLE;
    document.body.innerHTML = `
      <aside>
        <a href="/manga/el-regreso-del-heroe">El Regreso del Héroe</a>
        <a href="/manga/solo-leveling">Solo Leveling</a>
      </aside>
    `;

    expect(seriesUrlFrom(document, CHAPTER_URL)).toBeNull();
  });

  it("does not let a shorter name inside the title claim it", () => {
    // "Solo Leveling" is in the title, but the title goes on to "Ragnarok":
    // the sidebar link is a different series.
    document.title = "Leer Solo Leveling Ragnarok Capitulo 5 - HeavenManga";
    document.body.innerHTML =
      '<a href="/manga/solo-leveling">Solo Leveling</a>';

    expect(seriesUrlFrom(document, CHAPTER_URL)).toBeNull();
  });

  it("prefers the longest name the title vouches for", () => {
    document.title = "Leer Solo Leveling Ragnarok Capitulo 5 - HeavenManga";
    document.body.innerHTML = `
      <a href="/manga/solo-leveling">Solo Leveling</a>
      <a href="/manga/solo-leveling-ragnarok">Solo Leveling Ragnarok</a>
    `;

    expect(seriesUrlFrom(document, CHAPTER_URL)).toBe(
      "https://heavenmanga.com/manga/solo-leveling-ragnarok/",
    );
  });

  it("never takes the section index itself", () => {
    document.title = "Leer Manga Capitulo 5";
    document.body.innerHTML = '<a href="/manga/">Manga</a>';

    expect(seriesUrlFrom(document, CHAPTER_URL)).toBeNull();
  });
});

describe("hinted series link (theme or site rule)", () => {
  // MangaThemesia: the chapter is a root-level page and the series link sits
  // nowhere near its path — only the theme knows which anchor it is.
  const CHAPTER_URL = "https://example.com/soy-un-dios-maligno-capitulo-567/";
  const HINTS = {
    reader: true,
    headingSelector: null,
    seriesLinkSelector: ".allc a",
  };

  it("takes the anchor the selector names", () => {
    document.body.innerHTML =
      '<div class="allc">Todos los capítulos de <a href="/manga/soy-un-dios-maligno/">Soy un Dios Maligno</a></div>';

    expect(seriesUrlFrom(document, CHAPTER_URL, HINTS)).toBe(
      "https://example.com/manga/soy-un-dios-maligno/",
    );
    expect(
      collectPageSignals(document, CHAPTER_URL, HINTS).seriesLinkTitle,
    ).toBe("Soy un Dios Maligno");
  });

  it("takes the last breadcrumb that leads off this page", () => {
    // Home › Series › this chapter, with the chapter itself linked.
    document.body.innerHTML = `
      <ol class="breadcrumb">
        <li><a href="/">Inicio</a></li>
        <li><a href="/manga/x/">Serie X</a></li>
        <li><a href="/soy-un-dios-maligno-capitulo-567/">Capítulo 567</a></li>
      </ol>`;

    expect(
      seriesUrlFrom(document, CHAPTER_URL, {
        ...HINTS,
        seriesLinkSelector: ".breadcrumb li a",
      }),
    ).toBe("https://example.com/manga/x/");
  });

  it("falls back to the page's own links when the selector finds nothing", () => {
    const nested = "https://mhscans.com/series/espadachin/capitulo-89/";
    document.body.innerHTML = '<a href="/series/espadachin/">Espadachin</a>';

    expect(seriesUrlFrom(document, nested, HINTS)).toBe(
      "https://mhscans.com/series/espadachin/",
    );
  });
});

describe("seriesUrlFrom", () => {
  const CHAPTER_URL =
    "https://mhscans.com/series/espadachin-a-tiempo-completo/capitulo-89-pack/";

  it("returns the absolute series url the chapter hangs off", () => {
    // Sent to the backend as identity within the site: it survives the site
    // reformatting its <title>, which a title-derived slug does not.
    document.body.innerHTML =
      '<a href="/series/espadachin-a-tiempo-completo/">Espadachín a Tiempo Completo</a>';

    expect(seriesUrlFrom(document, CHAPTER_URL)).toBe(
      "https://mhscans.com/series/espadachin-a-tiempo-completo/",
    );
  });

  it("is null when the page has no usable series link", () => {
    document.body.innerHTML =
      '<a href="/series/espadachin-a-tiempo-completo/">Ver todos los capítulos</a>';

    expect(seriesUrlFrom(document, CHAPTER_URL)).toBeNull();
  });

  it("stays consistent with the title signal it shares its search with", () => {
    document.body.innerHTML =
      '<a href="/series/espadachin-a-tiempo-completo/">Espadachín a Tiempo Completo</a>';

    expect(seriesUrlFrom(document, CHAPTER_URL)).not.toBeNull();
    expect(collectPageSignals(document, CHAPTER_URL).seriesLinkTitle).not.toBe(
      null,
    );
  });
});

describe("coverFromDocument", () => {
  it("returns the og:image url", () => {
    document.head.innerHTML =
      '<meta property="og:image" content="https://cdn.example.com/cover.jpg" />';

    expect(coverFromDocument(document)).toBe(
      "https://cdn.example.com/cover.jpg",
    );
  });

  it("falls back to twitter:image", () => {
    document.head.innerHTML =
      '<meta name="twitter:image" content="https://cdn.example.com/tw.jpg" />';

    expect(coverFromDocument(document)).toBe("https://cdn.example.com/tw.jpg");
  });

  it("returns null when the page declares no image", () => {
    expect(coverFromDocument(document)).toBeNull();
  });

  it("rejects non-http schemes", () => {
    document.head.innerHTML =
      '<meta property="og:image" content="data:image/png;base64,xyz" />';

    expect(coverFromDocument(document)).toBeNull();
  });

  it("rejects site branding images (olympus logo case)", () => {
    document.head.innerHTML =
      '<meta property="og:image" content="https://olympusxyz.com/olympus-logo-180.webp" />';

    expect(coverFromDocument(document)).toBeNull();
  });
});
