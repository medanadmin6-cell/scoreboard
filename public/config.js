// Change the brand here. Everything on the site reads from this file.
window.SITE = {
  name: 'ScoreNest',
  tagline: 'Live scores, fixtures, results and tables',
  refreshMs: 30000,

  sports: {
    football: {
      label: 'Football', espn: 'soccer',
      // `af` = API-Football league id (used when the server has API_FOOTBALL_KEY),
      // `slug` = ESPN fallback. With API-Football every league in the world is shown;
      // these are pinned to the top in this order.
      leagues: [
        { af: 39, slug: 'eng.1', name: 'Premier League', country: 'England' },
        { af: 2, slug: 'uefa.champions', name: 'Champions League', country: 'Europe' },
        { af: 140, slug: 'esp.1', name: 'LaLiga', country: 'Spain' },
        { af: 135, slug: 'ita.1', name: 'Serie A', country: 'Italy' },
        { af: 78, slug: 'ger.1', name: 'Bundesliga', country: 'Germany' },
        { af: 61, slug: 'fra.1', name: 'Ligue 1', country: 'France' },
        { af: 3, slug: 'uefa.europa', name: 'Europa League', country: 'Europe' },
        { af: 848, slug: 'uefa.europa.conf', name: 'Conference League', country: 'Europe' },
        { af: 40, slug: 'eng.2', name: 'Championship', country: 'England' },
        { af: 48, slug: 'eng.league_cup', name: 'Carabao Cup', country: 'England' },
        { af: 45, slug: 'eng.fa', name: 'FA Cup', country: 'England' },
        { af: 143, slug: 'esp.copa_del_rey', name: 'Copa del Rey', country: 'Spain' },
        { af: 137, slug: 'ita.coppa_italia', name: 'Coppa Italia', country: 'Italy' },
        { af: 81, slug: 'ger.dfb_pokal', name: 'DFB Pokal', country: 'Germany' },
        { af: 88, slug: 'ned.1', name: 'Eredivisie', country: 'Netherlands' },
        { af: 94, slug: 'por.1', name: 'Primeira Liga', country: 'Portugal' },
        { af: 179, slug: 'sco.1', name: 'Premiership', country: 'Scotland' },
        { af: 203, slug: 'tur.1', name: 'Super Lig', country: 'Turkey' },
        { af: 144, slug: 'bel.1', name: 'Pro League', country: 'Belgium' },
        { af: 307, slug: 'ksa.1', name: 'Saudi Pro League', country: 'Saudi Arabia' },
        { af: 253, slug: 'usa.1', name: 'MLS', country: 'USA' },
        { af: 262, slug: 'mex.1', name: 'Liga MX', country: 'Mexico' },
        { af: 71, slug: 'bra.1', name: 'Serie A', country: 'Brazil' },
        { af: 128, slug: 'arg.1', name: 'Liga Profesional', country: 'Argentina' },
        { af: 12, slug: 'caf.champions', name: 'CAF Champions League', country: 'Africa' },
        { af: 20, slug: 'caf.confed', name: 'CAF Confederation Cup', country: 'Africa' },
        { af: 570, slug: 'gha.1', name: 'Premier League', country: 'Ghana' },
        { af: 399, slug: 'nga.1', name: 'NPFL', country: 'Nigeria' },
        { af: 288, slug: 'rsa.1', name: 'Premiership', country: 'South Africa' },
      ],
    },
    basketball: {
      label: 'Basketball', espn: 'basketball',
      leagues: [
        { slug: 'nba', name: 'NBA', country: 'USA' },
        { slug: 'wnba', name: 'WNBA', country: 'USA' },
        { slug: 'mens-college-basketball', name: 'NCAA Men', country: 'USA' },
      ],
    },
    hockey: {
      label: 'Hockey', espn: 'hockey',
      leagues: [{ slug: 'nhl', name: 'NHL', country: 'USA' }],
    },
    americanfootball: {
      label: 'Am. Football', espn: 'football',
      leagues: [
        { slug: 'nfl', name: 'NFL', country: 'USA' },
        { slug: 'college-football', name: 'NCAA Football', country: 'USA' },
      ],
    },
    baseball: {
      label: 'Baseball', espn: 'baseball',
      leagues: [{ slug: 'mlb', name: 'MLB', country: 'USA' }],
    },
  },
};
