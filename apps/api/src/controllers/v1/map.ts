import { Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  legacyCrawlerOptions,
  mapRequestSchema,
  RequestWithAuth,
} from "./types";
import { crawlToCrawler, StoredCrawl } from "../../lib/crawl-redis";
import { MapResponse, MapRequest } from "./types";
import { configDotenv } from "dotenv";
import {
  checkAndUpdateURLForMap,
  isSameDomain,
  isSameSubdomain,
} from "../../lib/validateUrl";
import { fireEngineMap } from "../../search/fireEngine";

configDotenv();

export async function mapController(
  req: RequestWithAuth<{}, MapResponse, MapRequest>,
  res: Response<MapResponse>
) {
  req.body = mapRequestSchema.parse(req.body);

  const id = uuidv4();
  let links: string[] = [req.body.url];


  const sc: StoredCrawl = {
    originUrl: req.body.url,
    crawlerOptions: legacyCrawlerOptions(req.body),
    pageOptions: {},
    team_id: req.auth.team_id,
    createdAt: Date.now(),
  };

  const crawler = crawlToCrawler(id, sc);

  const sitemap =
    req.body.ignoreSitemap
      ? null
      : await crawler.tryGetSitemap();

  if (sitemap !== null) {
    sitemap.map((x) => {
      links.push(x.url);
    });
  }

  let urlWithoutWww = req.body.url.replace("www.", "");
  
  let mapUrl = req.body.search
    ? `"${req.body.search}" site:${urlWithoutWww}`
    : `site:${req.body.url}`;
  // www. seems to exclude subdomains in some cases
  const mapResults = await fireEngineMap(mapUrl, {
    numResults: 50,
  });

  if (mapResults.length > 0) {
    if (req.body.search) {
      // Ensure all map results are first, maintaining their order
      links = [mapResults[0].url, ...mapResults.slice(1).map(x => x.url), ...links];
    } else {
      mapResults.map((x) => {
        links.push(x.url);
      });
    }
  }

  links = links.map((x) => checkAndUpdateURLForMap(x).url.trim());



  // allows for subdomains to be included
  links = links.filter((x) => isSameDomain(x, req.body.url));

  // if includeSubdomains is false, filter out subdomains
  if (!req.body.includeSubdomains) {
    links = links.filter((x) => isSameSubdomain(x, req.body.url));
  }

  // remove duplicates that could be due to http/https or www
  links = [...new Set(links)];

  return res.status(200).json({
    success: true,
    links,
  });
}
