// parks.js
// Each park includes:
//   lat/lon    – main visitor center / primary entrance (used for routing)
//   vcLat/vcLon – same as lat/lon (alias kept for future overrides)
//   state      – 2-letter postal abbreviation
//   parkCode   – NPS API park code
//   description – one-sentence summary shown in hover popups
window.PARKS = [
  {
    name: "Acadia National Park",
    parkCode: "acad", state: "ME",
    lat: 44.3598,  lon: -68.2296,
    description: "Rocky coastline, wooded mountains, and glacier-carved lakes on Maine's Mount Desert Island."
  },
  {
    name: "American Samoa National Park",
    parkCode: "npsa", state: "AS",
    lat: -14.2630, lon: -170.6897,
    description: "Tropical rainforest, coral reefs, and Samoan culture on remote South Pacific islands."
  },
  {
    name: "Arches National Park",
    parkCode: "arch", state: "UT",
    lat: 38.6174,  lon: -109.6197,
    description: "Over 2,000 natural sandstone arches sculpted by erosion in a stunning red-rock desert."
  },
  {
    name: "Badlands National Park",
    parkCode: "badl", state: "SD",
    lat: 43.7854,  lon: -101.9417,
    description: "Dramatically eroded buttes, pinnacles, and spires rise from South Dakota's fossil-rich plains."
  },
  {
    name: "Big Bend National Park",
    parkCode: "bibe", state: "TX",
    lat: 29.3241,  lon: -103.1945,
    description: "Remote Chihuahuan Desert wilderness cradled in a great bend of the Rio Grande."
  },
  {
    name: "Biscayne National Park",
    parkCode: "bisc", state: "FL",
    lat: 25.4651,  lon: -80.3296,
    description: "Turquoise waters, living coral reefs, and mangrove shorelines at the tip of South Florida."
  },
  {
    name: "Black Canyon of the Gunnison National Park",
    parkCode: "blca", state: "CO",
    lat: 38.5725,  lon: -107.7248,
    description: "One of North America's most dramatic gorges, with sheer dark walls plunging nearly 2,700 feet."
  },
  {
    name: "Bryce Canyon National Park",
    parkCode: "brca", state: "UT",
    lat: 37.6404,  lon: -112.1671,
    description: "Surreal red, orange, and white hoodoos fill a sweeping high-plateau amphitheater."
  },
  {
    name: "Canyonlands National Park",
    parkCode: "cany", state: "UT",
    lat: 38.4531,  lon: -109.8209,
    description: "Vast canyon wilderness carved by the Colorado and Green Rivers in the heart of Utah."
  },
  {
    name: "Capitol Reef National Park",
    parkCode: "care", state: "UT",
    lat: 38.2908,  lon: -111.2614,
    description: "A 100-mile wrinkle in the Earth's crust packed with cliffs, canyons, domes, and bridges."
  },
  {
    name: "Carlsbad Caverns National Park",
    parkCode: "cave", state: "NM",
    lat: 32.1747,  lon: -104.4430,
    description: "Hundreds of caves beneath the Chihuahuan Desert, including the world-famous Big Room."
  },
  {
    name: "Channel Islands National Park",
    parkCode: "chis", state: "CA",
    lat: 34.0080,  lon: -119.6932,
    description: "Five pristine island ecosystems off the Southern California coast, rich in endemic wildlife."
  },
  {
    name: "Congaree National Park",
    parkCode: "cong", state: "SC",
    lat: 33.7956,  lon: -80.7895,
    description: "The largest intact expanse of old-growth bottomland hardwood forest in the Southeast."
  },
  {
    name: "Crater Lake National Park",
    parkCode: "crla", state: "OR",
    lat: 42.9068,  lon: -122.1495,
    description: "The deepest lake in the US fills the caldera of an ancient collapsed volcano in Oregon."
  },
  {
    name: "Cuyahoga Valley National Park",
    parkCode: "cuva", state: "OH",
    lat: 41.2620,  lon: -81.5632,
    description: "A forested river valley with waterfalls and historic canal remnants between Cleveland and Akron."
  },
  {
    name: "Death Valley National Park",
    parkCode: "deva", state: "CA",
    lat: 36.4617,  lon: -116.8690,
    description: "The hottest, driest, and lowest national park in the US — a land of breathtaking extremes."
  },
  {
    name: "Denali National Park",
    parkCode: "dena", state: "AK",
    lat: 63.7298,  lon: -148.9165,
    description: "North America's highest peak towers over six million acres of wild Alaskan wilderness."
  },
  {
    name: "Dry Tortugas National Park",
    parkCode: "drto", state: "FL",
    lat: 24.6285,  lon: -82.8732,
    description: "Remote island fort and pristine coral reefs 70 miles west of Key West, accessible only by boat or seaplane."
  },
  {
    name: "Everglades National Park",
    parkCode: "ever", state: "FL",
    lat: 25.3964,  lon: -80.5815,
    description: "The largest subtropical wilderness in the US, teeming with alligators, manatees, and wading birds."
  },
  {
    name: "Gates of the Arctic National Park",
    parkCode: "gaar", state: "AK",
    lat: 67.7805,  lon: -153.2918,
    description: "North of the Arctic Circle, one of the most remote and untouched wilderness areas on Earth."
  },
  {
    name: "Gateway Arch National Park",
    parkCode: "jeff", state: "MO",
    lat: 38.6245,  lon: -90.1856,
    description: "The iconic 630-foot stainless-steel Gateway Arch celebrates America's westward expansion in St. Louis."
  },
  {
    name: "Glacier National Park",
    parkCode: "glac", state: "MT",
    lat: 48.4940,  lon: -113.9820,
    description: "Over 700 miles of trails wind through rugged peaks, turquoise lakes, and retreating glaciers in Montana."
  },
  {
    name: "Glacier Bay National Park",
    parkCode: "glba", state: "AK",
    lat: 58.4566,  lon: -135.8897,
    description: "A dynamic landscape of tidewater glaciers, icebergs, humpback whales, and diverse wildlife in Alaska."
  },
  {
    name: "Grand Canyon National Park",
    parkCode: "grca", state: "AZ",
    lat: 36.0570,  lon: -112.1409,
    description: "One of the world's great natural wonders — a mile-deep canyon carved by the Colorado River."
  },
  {
    name: "Grand Teton National Park",
    parkCode: "grte", state: "WY",
    lat: 43.6573,  lon: -110.7028,
    description: "Dramatic granite peaks rise abruptly above Jackson Hole with pristine lakes and abundant wildlife."
  },
  {
    name: "Great Basin National Park",
    parkCode: "grba", state: "NV",
    lat: 38.9830,  lon: -114.2143,
    description: "Ancient bristlecone pine forests, marble caverns, and a glacial lake in the heart of Nevada."
  },
  {
    name: "Great Sand Dunes National Park",
    parkCode: "grsa", state: "CO",
    lat: 37.7306,  lon: -105.5147,
    description: "North America's tallest sand dunes rise against the Sangre de Cristo Mountains in southern Colorado."
  },
  {
    name: "Great Smoky Mountains National Park",
    parkCode: "grsm", state: "TN",
    lat: 35.6868,  lon: -83.5362,
    description: "America's most visited national park — lush forests, diverse wildlife, and ancient mountain beauty."
  },
  {
    name: "Guadalupe Mountains National Park",
    parkCode: "gumo", state: "TX",
    lat: 31.9234,  lon: -104.8195,
    description: "The world's most extensive Permian fossil reef rises dramatically from the Chihuahuan Desert."
  },
  {
    name: "Haleakalā National Park",
    parkCode: "hale", state: "HI",
    lat: 20.7140,  lon: -156.2517,
    description: "A massive shield volcano on Maui with a surreal summit crater landscape floating above the clouds."
  },
  {
    name: "Hawaiʻi Volcanoes National Park",
    parkCode: "havo", state: "HI",
    lat: 19.4298,  lon: -155.2577,
    description: "Active volcanoes continuously shape the youngest land on Earth on Hawaii's Big Island."
  },
  {
    name: "Hot Springs National Park",
    parkCode: "hosp", state: "AR",
    lat: 34.5116,  lon: -93.0553,
    description: "Historic bathhouses surround 47 naturally thermal springs in Arkansas's Ouachita Mountains."
  },
  {
    name: "Indiana Dunes National Park",
    parkCode: "indu", state: "IN",
    lat: 41.6350,  lon: -87.0694,
    description: "Towering sand dunes and surprising biodiversity along 15 miles of Lake Michigan shoreline."
  },
  {
    name: "Isle Royale National Park",
    parkCode: "isro", state: "MI",
    lat: 47.9937,  lon: -88.4930,
    description: "A remote Lake Superior island wilderness renowned for wolves, moose, and profound solitude."
  },
  {
    name: "Joshua Tree National Park",
    parkCode: "jotr", state: "CA",
    lat: 34.0133,  lon: -116.0510,
    description: "Two desert ecosystems meet in a surreal landscape of twisted Joshua trees and giant boulder piles."
  },
  {
    name: "Katmai National Park",
    parkCode: "katm", state: "AK",
    lat: 58.5600,  lon: -155.0514,
    description: "Famous for brown bears catching sockeye salmon at Brooks Falls in remote Alaskan wilderness."
  },
  {
    name: "Kenai Fjords National Park",
    parkCode: "kefj", state: "AK",
    lat: 60.1044,  lon: -149.4416,
    description: "Tidewater glaciers, dramatic fjords, and abundant marine wildlife on Alaska's Kenai Peninsula."
  },
  {
    name: "Kings Canyon National Park",
    parkCode: "seki", state: "CA",
    lat: 36.7355,  lon: -118.9671,
    description: "Deep granite canyons and magnificent giant sequoias in the rugged southern Sierra Nevada."
  },
  {
    name: "Kobuk Valley National Park",
    parkCode: "kova", state: "AK",
    lat: 66.8982,  lon: -162.5974,
    description: "A remote Arctic valley with massive inland sand dunes and vast migrating caribou herds."
  },
  {
    name: "Lake Clark National Park",
    parkCode: "lacl", state: "AK",
    lat: 60.2021,  lon: -154.3148,
    description: "Dramatic volcanic peaks, glaciers, and wild rivers in a pristine and largely untouched Alaska wilderness."
  },
  {
    name: "Lassen Volcanic National Park",
    parkCode: "lavo", state: "CA",
    lat: 40.3403,  lon: -121.5419,
    description: "The southernmost active volcano in the Cascades surrounded by boiling springs and bubbling mud pots."
  },
  {
    name: "Mammoth Cave National Park",
    parkCode: "maca", state: "KY",
    lat: 37.1857,  lon: -86.0985,
    description: "The world's longest known cave system winds beneath Kentucky's gently rolling karst landscape."
  },
  {
    name: "Mesa Verde National Park",
    parkCode: "meve", state: "CO",
    lat: 37.1851,  lon: -108.4904,
    description: "Remarkable cliff dwellings preserve the ancestral Puebloan culture of the American Southwest."
  },
  {
    name: "Mount Rainier National Park",
    parkCode: "mora", state: "WA",
    lat: 46.7849,  lon: -121.7365,
    description: "An active ice-draped stratovolcano dominates Washington's Cascades, ringed by wildflower meadows."
  },
  {
    name: "New River Gorge National Park",
    parkCode: "neri", state: "WV",
    lat: 38.0698,  lon: -81.0806,
    description: "A wild and scenic river carved through ancient Appalachian highlands in West Virginia."
  },
  {
    name: "North Cascades National Park",
    parkCode: "noca", state: "WA",
    lat: 48.6770,  lon: -121.2454,
    description: "Jagged peaks, more than 300 glaciers, and pristine wilderness in Washington's wild north."
  },
  {
    name: "Olympic National Park",
    parkCode: "olym", state: "WA",
    lat: 48.1022,  lon: -123.4256,
    description: "Three distinct worlds — glacier-capped peaks, lush temperate rainforest, and wild Pacific coastline."
  },
  {
    name: "Petrified Forest National Park",
    parkCode: "pefo", state: "AZ",
    lat: 34.9843,  lon: -109.8042,
    description: "Ancient logs turned to crystal and vivid painted desert badlands stretch across northeastern Arizona."
  },
  {
    name: "Pinnacles National Park",
    parkCode: "pinn", state: "CA",
    lat: 36.4906,  lon: -121.1965,
    description: "Volcanic spire formations and boulder-filled talus caves rise from California's Gabilan Mountains."
  },
  {
    name: "Redwood National Park",
    parkCode: "redw", state: "CA",
    lat: 41.2849,  lon: -124.0815,
    description: "The world's tallest trees tower in coastal fog along Northern California's stunning shoreline."
  },
  {
    name: "Rocky Mountain National Park",
    parkCode: "romo", state: "CO",
    lat: 40.3639,  lon: -105.5919,
    description: "Dramatic peaks, alpine tundra, and abundant elk straddle the Continental Divide in Colorado."
  },
  {
    name: "Saguaro National Park",
    parkCode: "sagu", state: "AZ",
    lat: 32.2994,  lon: -111.2174,
    description: "The iconic saguaro cactus defines the Sonoran Desert landscape surrounding Tucson, Arizona."
  },
  {
    name: "Sequoia National Park",
    parkCode: "seki", state: "CA",
    lat: 36.4622,  lon: -118.8246,
    description: "Home to the largest trees on Earth by volume, including the 2,000-year-old General Sherman Tree."
  },
  {
    name: "Shenandoah National Park",
    parkCode: "shen", state: "VA",
    lat: 38.8761,  lon: -78.2065,
    description: "Scenic Skyline Drive winds along the Blue Ridge crest through forested Virginia highlands."
  },
  {
    name: "Theodore Roosevelt National Park",
    parkCode: "thro", state: "ND",
    lat: 46.9283,  lon: -103.5465,
    description: "Rugged North Dakota badlands where a young Theodore Roosevelt found his wilderness calling."
  },
  {
    name: "Virgin Islands National Park",
    parkCode: "viis", state: "VI",
    lat: 18.3318,  lon: -64.7928,
    description: "Coral reefs, white-sand beaches, and lush tropical forest cover two-thirds of St. John island."
  },
  {
    name: "Voyageurs National Park",
    parkCode: "voya", state: "MN",
    lat: 48.5718,  lon: -93.3878,
    description: "A water-based park of interconnected lakes, islands, and boreal forest near the Canadian border."
  },
  {
    name: "White Sands National Park",
    parkCode: "whsa", state: "NM",
    lat: 32.7791,  lon: -106.1716,
    description: "The world's largest gypsum dune field shimmers brilliant white in the Tularosa Basin."
  },
  {
    name: "Wind Cave National Park",
    parkCode: "wica", state: "SD",
    lat: 43.5567,  lon: -103.4787,
    description: "One of the world's longest and most complex cave systems lies beneath South Dakota's Black Hills."
  },
  {
    name: "Wrangell–St. Elias National Park",
    parkCode: "wrst", state: "AK",
    lat: 61.9498,  lon: -145.3141,
    description: "The largest US national park — bigger than Switzerland — with towering peaks and vast glaciers."
  },
  {
    name: "Yellowstone National Park",
    parkCode: "yell", state: "WY",
    lat: 44.4605,  lon: -110.8281,
    description: "The world's largest geothermal area, with geysers, hot springs, bison herds, and diverse megafauna."
  },
  {
    name: "Yosemite National Park",
    parkCode: "yose", state: "CA",
    lat: 37.7489,  lon: -119.5888,
    description: "Iconic granite cliffs, giant sequoias, and thundering waterfalls define this Sierra Nevada gem."
  },
  {
    name: "Zion National Park",
    parkCode: "zion", state: "UT",
    lat: 37.1988,  lon: -112.9861,
    description: "Massive Navajo sandstone cliffs and narrow slot canyons carved by the Virgin River in Utah."
  }
];
