//----------------------------------------------------------------------
const config = AppConfig.teleporter || {};

//----------------------------------------------------------------------
class TeleportController
{
    //----------------------------------------------------------------------
    constructor(characterControllerEntity)
    {
        this.characterControllerEntity = characterControllerEntity;

        this.sdk        = SDK3DVerse;
        this.engineAPI  = SDK3DVerse.engineAPI;
        this.cameraAPI  = SDK3DVerse.engineAPI.cameraAPI;
        this.THREE      = SDK3DVerse.threeJS.THREE;

        this.teleporters = [];

        this.globalMatrix       = new this.THREE.Matrix4();
        this.viewMatrix         = new this.THREE.Matrix4();
        this.positionInGeometry = new this.THREE.Vector3();
    }

    //--------------------------------------------------------------------------
    async initialize()
    {
        this.teleporters = await SDK3DVerse.engineAPI.filterEntities({ mandatoryComponents: ['box_geometry'], forbiddenComponents: ['physics_material'] });
        this.teleporters = this.teleporters.filter(e => e.getName().startsWith(config.sourcePrefix));

        console.debug('teleporters:', this.teleporters)
        SDK3DVerse.notifier.on('OnCamerasUpdated', this.onCamerasUpdated);
    }

    //--------------------------------------------------------------------------
    onCamerasUpdated = async (cameras) =>
    {
        let currentViewportEnabled = this.cameraAPI.getActiveViewports();
        currentViewportEnabled = currentViewportEnabled && currentViewportEnabled[0];
        if (!currentViewportEnabled)
        {
            // No current viewport means the canvas has not been clicked
            return;
        }

        let teleporterHit;
        const viewportTransform = currentViewportEnabled.getTransform();


        // Search if camera is inside a teleporter box geometry
        for(teleporterHit of this.teleporters)
        {
            if(this.isInsideGeometry(viewportTransform.position, teleporterHit))
            {
                break;
            }
            teleporterHit = null;
        }

        if(!teleporterHit)
        {
            return;
        }

        const children = await this.engineAPI.getEntityChildren(teleporterHit);
        const destination = children.find(e => e.getName().startsWith(config.destinationPrefix));

        if(!destination)
        {
            return;
        }

        // teleport
        this.characterControllerEntity.setGlobalTransform({
            position: destination.getGlobalTransform().position
        });
        this.engineAPI.propagateChanges()
    }

    //--------------------------------------------------------------------------
    isInsideGeometry(globalPosition, geometry)
    {
        this.globalMatrix.fromArray(geometry.getGlobalMatrix());
        this.viewMatrix.getInverse(this.globalMatrix);

        this.positionInGeometry.fromArray(globalPosition);
        this.positionInGeometry.applyMatrix4(this.viewMatrix);

        const { dimension: dimensions, offset: offsets } = geometry.getComponent('box_geometry');

        if (!(Math.abs(this.positionInGeometry.x - offsets[0]) < dimensions[0]))
        {
            return false;
        }
        else if (!(Math.abs(this.positionInGeometry.y - offsets[1]) < dimensions[1]))
        {
            return false;
        }
        else if (!(Math.abs(this.positionInGeometry.z - offsets[2]) < dimensions[2]))
        {
            return false;
        }

        return true;
    }
}


