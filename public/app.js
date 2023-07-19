//--------------------------------------------------------------------------------------------------
const teleporterConfig = AppConfig.teleporter || {};
const videoScreenConfig = AppConfig.videoScreen || {};
window.addEventListener('load', InitApp);

//--------------------------------------------------------------------------------------------------
async function InitApp()
{
    const joysticksElement = document.getElementById('joysticks');
    SDK3DVerse.installExtension(SDK3DVerse_VirtualJoystick_Ext, null, joysticksElement);

    SDK3DVerse.setViewports(null);
    SetResolution();

    let debounceResizeTimeout = null;
    window.addEventListener('resize', () =>
    {
        if(debounceResizeTimeout)
        {
            clearTimeout(debounceResizeTimeout);
        }
        debounceResizeTimeout = setTimeout(() =>
        {
            SetResolution(false);
            debounceResizeTimeout = null;
        }, 100);
    });

    const sessionCreated = await Connect();

    const hasPlayer = (await getPlayers()).length > 0;
    if (sessionCreated || !hasPlayer)
    {
        // This must be done before attaching the camera & controller scripts.
        // The hasPlayer allows to start the simulation if the session was created by something else
        // than the current application. But it means we could start simulation more than one time
        // in the same session if all player have left and new one comes in.
        console.debug("Start simulation");
        SDK3DVerse.engineAPI.fireEvent(SDK3DVerse.utils.invalidUUID, "start_simulation");
    }

    // spawn the player entity which have its own camera entity & character controller entity
    const {
        playerEntity,
        cameraEntity,
        characterController
     } = await SpawnPlayer();

    await attachScripts(cameraEntity, characterController);
    await initViewport(cameraEntity);

    // enableVideoScreens (backward compatibility)
    if(AppConfig.enableVideoScreens || videoScreenConfig.enabled)
    {
        // Init the video player
        await SDK3DVerse.installExtension(SDK3DVerse_ThreeJS_Ext);

        const videoPlayer = new VideoPlayer(playerEntity);
        window.sampleApp = { videoPlayer };
        await videoPlayer.initialize();
    }
    if(teleporterConfig.enabled)
    {
        const teleportController = new TeleportController(characterController);
        await teleportController.initialize();
    }
}

//--------------------------------------------------------------------------------------------------
// use setTimeout to delay a task that may be async (returning a promise) or not.
// wrap the setTimeout in a Promise that can be awaited.
function asyncSetTimeout(task, delay)
{
    return new Promise((resolve, reject) =>
    {
        setTimeout(() =>
        {
            let result;
            try
            {
                result = task();
            }
            catch(error)
            {
                // the task has thrown an error
                return reject(error);
            }

            if(result && typeof result.then === 'function')
            {
                // the result is a promise so we deal with it
                return result.then(resolve).catch(reject);
            }

            // the result is not a promise so we can resolve it
            return resolve(result);
        }, delay);
    });
}

//--------------------------------------------------------------------------------------------------
function SetInformation(str)
{
    const infoSpan      = document.getElementById('info_span');
    infoSpan.innerHTML  = str;
    console.debug(str);
}

//--------------------------------------------------------------------------------------------------
function FadeOut()
{
    const fade = document.getElementById('fade');
    fade.style.animation = "fadeOut linear 2s";
}

//--------------------------------------------------------------------------------------------------
function SetResolution(showInfo = true)
{
    const container     = document.getElementById('container');
    const canvasSize    = container.getBoundingClientRect();
    //const canvasSize    = {width: window.innerWidth, height: window.innerHeight};

    const largestDim    = Math.max(canvasSize.width, canvasSize.height);
    const MAX_DIM       = 1920;
    const scale         = (largestDim > MAX_DIM) ? (MAX_DIM / largestDim) : 1;

    let w               = Math.floor(canvasSize.width);
    let h               = Math.floor(canvasSize.height);
    const aspectRatio   = w/h;

    if(w > h)
    {
        // landscape
        w = Math.floor(aspectRatio * h);
    }
    else
    {
        // portrait
        h = Math.floor(w / aspectRatio);
    }
    SDK3DVerse.setResolution(w, h, scale);

    if(showInfo)
    {
        SetInformation(`Setting resolution to ${w} x ${h} (scale=${scale})`);
    }
}

//--------------------------------------------------------------------------------------------------
async function Connect()
{
    SetInformation("Connecting to 3dverse...");

    const connectionInfo = await SDK3DVerse.webAPI.createOrJoinSession(AppConfig.sceneUUID);

    // TODO: Need to force SSL when using microverse app "Open Dev Tool": figure out a better way to force tha tin this specific case.
    connectionInfo.useSSL = true;

    SDK3DVerse.setupDisplay(document.getElementById('display_canvas'));
    SDK3DVerse.startStreamer(connectionInfo);
    await SDK3DVerse.connectToEditor();

    SetInformation("Connection to 3dverse established...");
    return connectionInfo.sessionCreated;
}
//--------------------------------------------------------------------------------------------------
async function getPlayers()
{
    let playerEntities = await SDK3DVerse.engineAPI.findEntitiesByNames('Player');

    playerEntities = playerEntities.filter(e =>
    {
        if(e && e.isAttached('scene_ref'))
        {
            return e.getComponent('scene_ref').value === AppConfig.characterControllerSceneUUID;
        }

        return false;
    });

    return playerEntities;
}

//--------------------------------------------------------------------------------------------------
async function SpawnPlayer()
{
    SetInformation("Prepping up your player's avatar...");

    const playerTemplate            = { debug_name : {value : 'Player'} };
    SDK3DVerse.utils.resolveComponentDependencies(playerTemplate, 'scene_ref');

    let characterControllerSceneUUID;
    if (Array.isArray(AppConfig.characterControllerSceneUUID))
    {
        const index = Math.floor(Math.random() * AppConfig.characterControllerSceneUUID.length);
        characterControllerSceneUUID = AppConfig.characterControllerSceneUUID[index];
    }
    else
    {
        characterControllerSceneUUID = AppConfig.characterControllerSceneUUID;
    }

    playerTemplate.scene_ref.value  = characterControllerSceneUUID;
    //const startPositions            = await SDK3DVerse.engineAPI.findEntitiesByNames("Start Position 1", "Start Position 2");
    //const rnd                       = Math.floor(Math.random() * startPositions.length);
    //playerTemplate.local_transform  = startPositions[rnd].getComponent('local_transform');

    const playerEntity              = await SDK3DVerse.engineAPI.spawnEntity(null, playerTemplate);
    const children                  = await SDK3DVerse.engineAPI.getEntityChildren(playerEntity);
    const cameraEntity              = children.find((child) => child.isAttached('camera'));
    const characterController       = children.find((child) => child.isAttached('character_controller'));

    window.onbeforeunload           = () => { SDK3DVerse.engineAPI.deleteEntities([playerEntity]); return null; };

    SetInformation("Awaiting teleportation accreditation...");

    return { playerEntity, cameraEntity, characterController};
}

//--------------------------------------------------------------------------------------------------
function attachScripts(cameraEntity, characterController)
{
    const cameraScriptUUID          = Object.keys(cameraEntity.getComponent("script_map").elements).pop();
    const controllerScriptUUID      = Object.keys(characterController.getComponent("script_map").elements).pop();

    SDK3DVerse.engineAPI.attachToScript(characterController, controllerScriptUUID);
    SDK3DVerse.engineAPI.attachToScript(cameraEntity, cameraScriptUUID);

    SetInformation("Teleportation accreditation granted, brace yourself...");
    document.getElementById('display_canvas').focus();
}

//--------------------------------------------------------------------------------------------------
async function initViewport(cameraEntity)
{
    const viewport = {
        id: 0,
        left: 0, top: 0, width: 1, height: 1,
        camera: cameraEntity,
        defaultCameraValues: SDK3DVerse.engineAPI.cameraAPI.getDefaultCameraValues(),
        //defaultPerspectiveLensValues: { fovy: 120 }
    };

    await SDK3DVerse.setViewports([viewport]);
    SetInformation("");
    FadeOut();

    console.debug('initViewport done for camera:', cameraEntity);
}
