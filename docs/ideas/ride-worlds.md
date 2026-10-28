# Ride Worlds ideas, parked

Jan parked these ideas from the Ride Worlds milestones M13 to M21 on 2026-10-25, to land the 3D world and keep the runners on indoor riding first. Their issues are closed as not planned, carry the `backlog` label and keep their milestone. The issue bodies hold the full design.

To bring an idea back, reopen its issues: `gh issue reopen <n> && gh issue edit <n> --remove-label backlog`.

Cost: S is one PR, M a few, L a milestone, XL new infrastructure or operations.

## M13: Ride it together

**Draft behind a crewmate on a free ride** (L; #3234, #3235, #3236). Crewmates free-riding the same road can sit on each other's wheel. The follower's trainer gets lighter, about 30 % fewer watts on the flat. A weaker rider can hold a stronger friend's wheel on the flat, as in an outdoor group. Needs: Crewmates see each other on the same road (#3117). Jan's patent search on drafting-to-trainer feedback.

**Who's in the bunch: the peloton list and riding in late** (M; #3107, #3108). A list at the right edge shows every rider in road order with zone, W/kg and gap. A late joiner rides in from the team car, and the list says so. In a session you want to see who is where and who just arrived, from the saddle. Needs: The riding surface's dock rework (#3668).

**A rider's card and the cheers you keep** (S; #3231). Tap a rider in the world to open their card with a big Cheer button. Cheers you get pulse your row, and the closing card says 'Cheered 7x by Kim, Tom and Sara'. Being cheered mid-ride feels good, and today the rider who gets a cheer keeps nothing of it.

**Ride photos and the café stop** (L; #3229, #3230, #3119). Snap the ride by key or phone remote, with auto-snaps at summits and the finish. Pausing a session rolls the bunch into a village café. Photos are fun and spread the word, but they make no ride on the trainer better. Needs: Real ground and place-name cuts from M14 and M20, for photos of other riders' routes.

**The world shows what broke** (S; #3227). When your trainer goes quiet on a solo ride, your figure coasts to the verge. When the connection drops, others fade with 'last seen 0:06'. A rider three metres from the screen sees a failure in the picture before reading any status line.

**The crew's roads** (M; #3682, #3106, #3104). A route page gets 'Plan it for a crew'. The crew's shelf shows 'left off at km 21.3 · Continue', and a crew can set a home road. A crew can plan from a road and ride a long one over weeks; the ride stays the same.

**Games drawn on the road** (M; #3114, #3115, #3649). Floor is Lava's zone becomes a lane, Watt Golf gets flags at roadside holes, and Sprint Roulette gets arches. The Skyline shows under a game on a road. It makes games look like the road, but every game already plays well without one. Needs: A screen that starts a game on a road (#3794). The relay on a road (#3030).

**The Prime** (S; #3109). A spectator opens a 15 s window, and riders score their best 5 s W/kg inside it. Nobody's trainer changes. A watching crewmate can start a surprise effort, which is fun but needs someone watching.

## M14: The real map and your road stats

**One climb, whichever file you rode it from** (XL; #3137, #3139, #3239, #3241, #3242, #3243, #3244, #3247, #3249, #3624). WattRoom knows a climb from the map, so every file that crosses it adds to one set of times. A climb page lists your efforts and lets you choose which ghost to race. It helps riders who reach one climb from several files. Per-route climb bests already show on the route page. Needs: 'A real map of your route' (the geo pack), 'Real places and climb names' (matching) and 'Privacy zones'.

**Real places and climb names on your road** (L; #3127, #3128, #3131, #3134, #3136, #3148). Village signs, the pass sign, fountains and churches stand at their real metres in the world. Climbs carry their real names on the climb card and in the FTP prompt. A road that reads like itself is more fun, but generated villages and numbered climbs already give rhythm. Needs: 'A real map of your route' (the geo pack) and 'Privacy zones'.

**A real map of your route** (XL; #3124, #3125, #3126, #3133, #3138). The route page, the picker and the ride page show a map of the road. It comes from WattRoom's own weekly copy of OpenStreetMap, credited on every surface. Riders like to see where a road goes, but the route drawing and profile already show what they will ride. Needs: Disk and a weekly timer on the operator's host (janlauber/homelab).

**Real gradients from survey heights** (XL; #3129, #3130). An imported route rides on swisstopo heights in Switzerland and Copernicus heights elsewhere. Bridges and tunnels ride flat, and grades match the real road. The trainer's resistance follows the true grade instead of GPS noise, which a rider feels on every climb. Needs: The geo pack host from 'A real map of your route' and map matching from 'Real places and climb names'.

**Privacy zones and a public start** (M; #3132). In Profile, Privacy, a rider draws circles around home. Crewmates on that route start at a public place outside every zone and never see inside one. It is the precondition for showing the crew any real place; on its own it gives a rider nothing to feel. Needs: 'Real places and climb names', since the public start is an OSM fountain, church or station.

**Your road after the ride** (L; #3140, #3141, #3691). After a road ride, the ride page and closing card show the profile with your zone trace. A climbs table gives each climb's time, VAM and PR flag, and the poster labels each climb. A rider sees what each climb cost, and the closing card offers to plan the next ride from here. Needs: Segment efforts from 'One climb, whichever file' and 'A real map of your route', as written.

**The Everest ladder** (S; #3144, #3693). The rider page shows lifetime metres climbed, with achievements at 8,849, 50,000 and 100,000 m. An HC climb in one ride earns one too, and a Collections tab under Rides holds the ladder. A long climbing goal gives a reason to pick a hilly road, but it is a stat after the ride. Needs: Nothing for the ladder. The Collections tab's climbs-by-class card waits on segment efforts.

**Everest together** (M; #3146). Crew Home shows the metres the crew climbed this month against 8,849 m. It also keeps the crew's fastest bunch time on each climb it rode together. A shared monthly goal gives the crew a reason to ride hills together, with nobody ranked. Needs: Nothing for the monthly tile. The crew's climbs need 'One climb, whichever file'.

**Crew climb times this week** (L; #3147, #3248). The crew's weekly board, when on, lists this week's fastest times and most ascents per climb by Category. Only opted-in riders appear, and a time that fails the trust checks stays private. Friendly weekly racing gives a solo ride a crew stake, but only when crewmates ride the same climbs. Needs: Segment efforts from 'One climb, whichever file'.

**Sprints at village signs** (S; #3135). In a session on a road, the hub arms a sprint at each village sign, announced 1 km ahead. It works like the KOM sprints that already arm. Sprints give a group short goals between climbs, and flat roads have no KOMs to fight over. Needs: 'Real places and climb names', as written.

## M15: The garage

**The garage: spend Batzen on looks your crew sees** (L; #3694, #3157, #3695, #3158, #3776, #3166). A Garage page turns the Batzen each saved ride earns into bikes, kits and helmets, with try-on and undo. Crewmates see your outfit on the road in sessions. A goal you can see is a reason to ride again, and crewmates become recognisable on the road.

**Change your figure after the first ask** (S; #3159). You change the build, height and skin tone set before your first road ride, or set them if you skipped. The figure ask shows once, so a rider who skipped or mistyped wears the wrong figure on every road ride.

**Crew kits** (M; #3161, #3162). A crew's owner or admins design one kit from a template, three colours and the crew icon. Members wear it in the crew's sessions, and spectators wear a matching scarf. A bunch in one kit reads as your crew at a glance, and the crew is the social unit.

**Medal jerseys and streak bunting** (S; #3165). At the next session, last session's medallists ride in a medal jersey and the Lanterne Rouge carries a red lantern. Bunting at the start shows one pennant per week of the crew streak. It carries last session's moment into this one, where the crew actually sees it.

**Bike accessories that fit the frame** (M; #3257, #3258). Bags, lights, bells, computers and caps can be fitted, and combinations that cannot exist are refused with a one-line hint. At a distance, accessories drop off to hold the frame rate. It makes a close-up bike look real, but it is depth on a garage nobody can use yet. Needs: The garage.

## M16: Races

**Groups, gaps and attack calls** (M; #3264, #3266, #3267). In a race, the rider list becomes groups with time gaps, such as 'Break (2) +0:18 closing'. A chalk slate updates at named points, and the radio calls attacks by name. It makes a big race readable from the bike; a four-rider race reads fine without it. Needs: Races you can start, and crews that race often enough to form groups.

**Co-op races against the devil** (M; #3170, #3269). In Chase the Devil, each Category chases its own devil at that Category's par, and spectators can tug its pace. In the Draft Train, the whole crew rides as one team against it, taking 30 s pulls. A mixed-ability crew races together, because everyone works against the devil instead of each other. Needs: Races you can start; the Draft Train also needs the groups idea.

**Race the col inside a group ride** (M; #3173). In a group workout on a road, riders who press 'Race the col' race that climb on W/kg. Everyone else rides it together, and the summit café waits up to 5 minutes. It adds a short race to the ride crews already do together, without splitting the session. Needs: The race closing card, from the race idea.

**A crowd on the last 1.5 km** (S; #3176). Spectator figures line the last 1.5 km of a race and step back as riders come near. It is a nice finish touch, but it changes nothing about how the race rides. Needs: The race world draw, from the race idea.

## M17: The living world

**Real villages, fields, forests and water along your road** (XL; #3179, #3180, #3181, #3182). The world draws the real place: houses on real footprints, fields, forest, streams with bridges, and lakes. Houses take regional styles, and inside privacy zones the generator still invents the scenery. Riding through a village you know is a pull, but the generated world already looks plausible. Needs: The M14 real map: the geo pack on the host (#3124, #3125) and the corridor (#3128).

**Alpine road furniture and real landmarks** (L; #3271, #3183, #3184). Avalanche galleries, snow poles, huts, summit crosses and cattle grids appear where the map has them. Real landmarks take fixed slots in the set-piece schedule, and small kits fill long empty stretches. It makes a pass look like a pass; filler for long empty stretches is what riders would miss most. Needs: The M14 corridor (#3128, #3179).

**Herds and birds** (M; #3185). Cows and other herds graze on pasture by region and season, and choughs, kites and swallows fly overhead. They hold still under reduced motion and never stand on the road. Small life makes a long climb feel less empty, but it is pure scenery. Needs: Land cover (#3180) and the catalogue (#3271) as written; the generated meadow biome would do for a first cut.

**Seasons and the moon** (S; #3187). The world's palette follows the date and hemisphere, with a snow line. The moon stands where it really is in its real phase, and hilltop bonfires burn on 1 August. It gives variety over a winter of trainer rides, and it changes nothing about the ride itself.

**The fog sea on climbs** (S; #3188). From September to April a sea of fog fills the valley, and the climb breaks out above it. The world announces the fog top before the rider reaches it. Breaking out of the fog gives a long climb a moment halfway up.

**Rain and snow on the road** (M; #3189, #3192, #3343). Some rides get rain or snow and a wet road, the same sky for the whole crew. Swiss routes could later follow real MeteoSwiss weather. Weather adds variety to the same road, but it is for the eyes only and never changes resistance. Needs: Real weather: the source is decided (MeteoSwiss, 2026-10-06), and Jan switches it on in janlauber/homelab.

**Crowds that fit the ride** (S; #3190). A solo ride passes a few locals by the road. A session gets its named spectators plus a crowd at the summit. A summit crowd is a small payoff for a crew; a few locals on a solo ride barely register.

## M18: The crew's world

**Hairpin plates with crewmates' names** (M; #3197). On the crew's climb in a session, each hairpin plate names the crewmate who first rode it. It puts a small crew story on the road while the crew rides it. Needs: The crew's climbs (#3146) and the server's climb rule (#3238), both M14.

## M19: The midweek

**Race a crewmate's best on a climb** (L; #3282). A rider turns on 'My climb lines ride with <crew>'. Crewmates can then race that rider's 90-day best on any climb. Chasing a slightly stronger friend keeps you pushing longer than chasing software does. Needs: Map-keyed climbs and stretches (M14). The board_ok flag on efforts.

**The col of the month** (L; #3280). Each month one library climb is featured. Ride it whole or its top half to stamp your col book. It gives riders a fresh road each month instead of their one home loop. Needs: M14's climb library, col book and stretches. The Crew Tour's opt-in, for the crew count.

**The Crew Tour** (L; #3278, #3279). A crew sets up a tour of stages, and every counted ride moves the caravan along it. Home names who moved it, never with numbers. It gives a solo ride a crew purpose, but the payoff is a progress card after the ride.

## M20: Real ground

**Real Swiss heights under your road** (XL; #3284, #3285, #3286, #3287, #3346). In Switzerland the world stands on swisstopo heights, so valleys, ridges and peaks are where they really are. Two routes over one stretch get the same ground. Local riders would know the valley, but the grade already comes from the GPX, so riding stays the same. Needs: The M14 geo pack and place tiles (#3240), then Jan's slow-rig run, national bake and host disk (#3346).

**The ground painted from aerial photos** (L; #3289, #3290, #3291). The ground shows graded SWISSIMAGE photos, tuned so a summer meadow does not read as snow at blue hour. A new tone curve keeps the rider's own watt colours exact. Photo ground makes the place recognisable at a glance, but it is scenery, not riding. Declined by ADR-0092 (2026-10-28): real ground shows land cover as flat colour instead.

**The real skyline, with peak names** (L; #3288). The horizon shows the real mountain range up to 80 km away, from panoramas on a fixed station grid. Peak names show for 8 s at crests when the peak is in view. Seeing the real range from a summit is the biggest realism win per byte, and riders remember it. Needs: Heights on the host (#3285) and OSM peak names from the M14 corridor (#3128).

**Trees where trees really stand** (L; #3292). Forest roads get real trees from the canopy model, detailed close up and as impostors out to 900 m. In the lab, trees turned a photo blanket into a forest road, but they don't change the ride. Needs: Real heights (#3287).

**Real ground outside Switzerland** (XL; #3296). Routes abroad get Copernicus heights and WorldCover land classes, coloured through the world palette. Roads through forest stay on the ground, not on the treetops. It matters only for routes abroad, and there the ground is the world palette, not a photo. Needs: Real Swiss heights and the place tiles (#3285).

**A Swiss-map look for the route page and closing card** (M; #3297). The route page, poster and closing card can draw real ground as a living Swiss map. It has relief colour, hachures, stippled forest and contours, and never shows on the ride. A desk look no cycling app has, but it shows only after the ride and only on real ground. Needs: Real Swiss heights (#3286).

## M21: Beyond your crew

**The road board on library climbs** (L; #3320). Each library climb shows an unnamed top ten per Category over 90 days, from riders who opted in. A rider can race one of those times as a ghost, or flag a time that looks wrong. A stranger's time gives a solo climb a target, but it brings ranking among strangers into a crew-first app. Needs: From M14: the library (#3149), segment efforts (#3139), ghosts (#3244), the climb page (#3247) and trusted rides (#3248).

**Open rides: a scheduled group ride across crews** (XL; #3302, #3304, #3305, #3306, #3307, #3308, #3309, #3310, #3311, #3312, #3313, #3316). A crew schedules a keep-together bunch on a library road, and any signed-in rider can join it. Each crew rides from its own voice channel, and other crews' riders are unnamed figures in a plain kit. A bigger bunch on a famous road is fun, but it needs enough riders, and crews already ride together. Needs: The road library (#3149), and Jan's own host crew opening rides every week (#3316).

**Leader calls on open rides** (S; #3314). The host crew's leaders send short calls from a closed set of six to everyone on the open ride. Each rider sees a line with a cue sound and can mute calls for that ride. It gives a host a presence with nothing to moderate, but it means nothing without open rides. Needs: Open rides.

**Race formats on open rides** (M; #3315). Open rides gain Chase the Devil and Wheelrace. The closing shows counts and the rider's own placing, never a list. Crew races already give most of this, and racing strangers shows roughly how strong each rider is. Needs: Open rides and the M16 race core.
