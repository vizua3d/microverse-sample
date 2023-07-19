//--------------------------------------------------------------------------
class VideoPlayer
{
    //----------------------------------------------------------------------
    constructor(playerEntity)
    {
        this.config = AppConfig.videoScreen || {};

        this.playerEntity = playerEntity;

        this.sdk        = SDK3DVerse;
        this.engineAPI  = SDK3DVerse.engineAPI;
        this.cameraAPI  = SDK3DVerse.engineAPI.cameraAPI;
        this.THREE      = SDK3DVerse.threeJS.THREE;

        const { CSS3DObject, CSS3DRenderer } = importCssRenderer(this.THREE);
        this.CSS3DObject    = CSS3DObject;

        this.scene    = new this.THREE.Scene();
        this.renderer = new CSS3DRenderer();

        this.globalMatrix       = new this.THREE.Matrix4();
        this.viewMatrix         = new this.THREE.Matrix4();
        this.positionInGeometry = new this.THREE.Vector3();
    }

    //--------------------------------------------------------------------------
    async findScreenEntities()
    {
        const entities = await this.engineAPI.filterEntities({ mandatoryComponents: [ 'scene_ref' ] });

        return entities.filter(entity =>
        {
            const name  = entity.getComponent('debug_name').value;
            const match = name.match(/Screen #\[(.*)\]/);

            if(match && match.length > 1)
            {
                entity.screenID = match[1];
                return true;
            }
            return false;
        });
    }

    //--------------------------------------------------------------------------
    async initialize(canvas, container)
    {
        // If the user refresh the app while the player is hidden then
        // the following hide/show instructions ensure the player is shown at startup
        SDK3DVerse.engineAPI.setEntityVisibility(sampleApp.videoPlayer.playerEntity, false);
        SDK3DVerse.engineAPI.setEntityVisibility(sampleApp.videoPlayer.playerEntity, true);

        canvas      = canvas || this.engineAPI.canvas;
        container   = container || canvas.parentNode;

        const screens = await this.findScreenEntities();

        if(!screens.length)
        {
            console.warn("VideoPlayer.initialize: none screen entity detected");
            return;
        }
        else
        {
            console.log("VideoPlayer.initialize detected following screen entities:", screens);
        }

        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

        // Define stylesheet of the renderer's div
        this.renderer.domElement.style.position      = 'absolute';
        this.renderer.domElement.style.top           = 0;
        this.renderer.domElement.style.pointerEvents = 'none';
        container.appendChild(this.renderer.domElement);

        this.videoElements = [];
        for (const screenEntity of screens)
        {
            // Create a video element, with the plane entity global transform.
            const videoElement = this.createVideoElement(screenEntity.screenID, screenEntity.getGlobalTransform());

            const children          = await this.engineAPI.getEntityChildren(screenEntity);
            videoElement.geometries = children.filter(entity => entity.isAttached('box_geometry'));

            this.videoElements.push(videoElement);
            this.scene.add(videoElement);
        }

        // The main render function of css3d
        this.sdk.notifier.on('onFramePostRender', () =>
        {
            const viewports = this.cameraAPI.getActiveViewports();
            for (const viewport of viewports)
            {
                const camera = viewport.threeJScamera;
                if (camera)
                {
                    this.renderer.render(this.scene, camera);
                }
            }
        });

        // Canvas resize event
        this.sdk.notifier.on('onCanvasResized', (width, height) => this.renderer.setSize(width, height));

        // This callback is triggered when any camera is moved
        this.sdk.notifier.on('OnCamerasUpdated', async cameras =>
        {
            // TODO: why the current viewport is null here?
            //const currentViewportEnabled = this.cameraAPI.currentViewportEnabled;
            let currentViewportEnabled = this.cameraAPI.getActiveViewports();
            currentViewportEnabled = currentViewportEnabled && currentViewportEnabled[0];
            if (!currentViewportEnabled)
            {
                // No current viewport means the canvas has not been clicked
                return;
            }

            const globalTransform = currentViewportEnabled.getTransform();

            // TODO: this is not changing, how to get player position?
            //const globalTransform = this.playerEntity.getComponent('local_transform');

            for (const videoElement of this.videoElements)
            {
                const isVisible = videoElement.isVisible();
                let isInside    = false;
                for (const box of videoElement.geometries)
                {
                    if (this.isInsideGeometry(globalTransform.position, box))
                    {
                        isInside = true;
                    }
                }

                if (isInside && !isVisible)
                {
                    videoElement.setVisibility(true);
                    await this.engineAPI.setEntityVisibility(this.playerEntity, false);
                }
                else if (!isInside && isVisible)
                {
                    videoElement.setVisibility(false);
                    await this.engineAPI.setEntityVisibility(this.playerEntity, true);
                }
            }
        });

        return true;
    }

    //--------------------------------------------------------------------------
    createVideoElement(id, globalTransform)
    {
        // The plane where the video is rendered is actually sized by
        // 2 units of width and height (2 squares in the debug lines) in its local space.
        const planeWidth  = 2;
        const planeHeight = 2;

        // In the scene, the plane entity is scaled with [16.0, 9.0, 1] in its
        // local_transform components to reproduce standard aspect ratio.
        const planeScale = globalTransform.scale;

        // 1px in css3dRenderer is 1 unit in the 3dverse space (i.e. 1 square in the debug lines)
        // Since 1 pixel for 1 unit would make a giant plane in the scene, we will scale it.
        const pixelToUnitScale = this.config.pixelToUnitScale || 400; // 100 pixel = 1 unit

        const iframeURL = [ 'https://www.youtube.com/embed/', id, '?rel=0', '&autoplay=1' ].join('');

        // We're going to apply the scale of the plane entity, on the dom's element width and height.
        const div        = document.createElement('div');
        div.style.width  = (planeScale[0] * pixelToUnitScale) + 'px';
        div.style.height = (planeScale[1] * pixelToUnitScale) + 'px';
        div.classList.add('video-element');

        const iframe        = document.createElement('iframe');
        iframe.style.width  = (planeScale[0] * pixelToUnitScale) + 'px';
        iframe.style.height = (planeScale[1] * pixelToUnitScale) + 'px';
        iframe.style.border = '0px';
        div.appendChild(iframe);

        const object = new this.CSS3DObject(div);
        object.position.fromArray(globalTransform.position);
        object.quaternion.fromArray(globalTransform.orientation);

        // The following statement will divide the scale by 50 to fit the plane,
        // since our unit scale is 100 and the plane is 2 unit of width and height
        object.scale.fromArray(
            [
                1 / (pixelToUnitScale / planeWidth),    // X
                1 / (pixelToUnitScale / planeHeight),   // Y
                1                                       // Z
            ]);
        object.updateMatrixWorld();

        object.isVisible = () =>
        {

            return div.classList.contains('visible');
        };

        object.setVisibility = (isVisible) =>
        {
            if (isVisible)
            {
                div.classList.add('visible');
                iframe.src = iframeURL;
            }
            else
            {
                div.classList.remove('visible');
                iframe.src = '';
            }
        };

        return object;
    };

    //--------------------------------------------------------------------------
    isInsideGeometry(globalPosition, geometry)
    {
        this.globalMatrix.fromArray(geometry.getGlobalMatrix());
        this.viewMatrix.getInverse(this.globalMatrix);

        this.positionInGeometry.fromArray(globalPosition);
        this.positionInGeometry.applyMatrix4(this.viewMatrix);

        const dimensions = geometry.getComponent('box_geometry').dimension;
        if (!(Math.abs(this.positionInGeometry.x) < dimensions[0]))
        {
            return false;
        }
        else if (!(Math.abs(this.positionInGeometry.y) < dimensions[1]))
        {
            return false;
        }
        else if (!(Math.abs(this.positionInGeometry.z) < dimensions[2]))
        {
            return false;
        }

        return true;
    }
}

//--------------------------------------------------------------------------
/**
 * Based on http://www.emagix.net/academic/mscs-project/item/camera-sync-with-css3-and-webgl-threejs
 */
const importCssRenderer = function (THREE)
{
    const { Matrix4, Object3D, Vector3 } = THREE;

    const CSS3DObject = function (element)
    {

        Object3D.call(this);

        this.element                     = element || document.createElement('div');
        this.element.style.position      = 'absolute';
        this.element.style.pointerEvents = 'auto';

        this.addEventListener('removed', function ()
        {

            this.traverse(function (object)
            {

                if (object.element instanceof Element && object.element.parentNode !== null)
                {

                    object.element.parentNode.removeChild(object.element);

                }

            });

        });

    };

    CSS3DObject.prototype = Object.assign(Object.create(Object3D.prototype), {

        constructor: CSS3DObject,

        copy: function (source, recursive)
        {

            Object3D.prototype.copy.call(this, source, recursive);

            this.element = source.element.cloneNode(true);

            return this;

        }

    });

    const CSS3DSprite = function (element)
    {

        CSS3DObject.call(this, element);

    };

    CSS3DSprite.prototype             = Object.create(CSS3DObject.prototype);
    CSS3DSprite.prototype.constructor = CSS3DSprite;

    const CSS3DRenderer = function ()
    {

        const _this = this;

        let _width, _height;
        let _widthHalf, _heightHalf;

        const matrix = new Matrix4();

        const cache = {
            camera : { fov: 0, style: '' },
            objects: new WeakMap()
        };

        const domElement            = document.createElement('div');
        domElement.style.overflow = 'hidden';

        this.domElement = domElement;

        const cameraElement = document.createElement('div');

        cameraElement.style.WebkitTransformStyle = 'preserve-3d';
        cameraElement.style.transformStyle       = 'preserve-3d';
        cameraElement.style.pointerEvents        = 'none';

        domElement.appendChild(cameraElement);

        const isIE = /Trident/i.test(navigator.userAgent);

        this.getSize = function ()
        {

            return {
                width : _width,
                height: _height
            };

        };

        this.setSize = function (width, height)
        {

            _width      = width;
            _height     = height;
            _widthHalf  = _width / 2;
            _heightHalf = _height / 2;

            domElement.style.width  = width + 'px';
            domElement.style.height = height + 'px';

            cameraElement.style.width  = width + 'px';
            cameraElement.style.height = height + 'px';

        };

        function epsilon(value)
        {

            return Math.abs(value) < 1e-10 ? 0 : value;

        }

        function getCameraCSSMatrix(matrix)
        {

            const elements = matrix.elements;

            return 'matrix3d(' +
                epsilon(elements[0]) + ',' +
                epsilon(-elements[1]) + ',' +
                epsilon(elements[2]) + ',' +
                epsilon(elements[3]) + ',' +
                epsilon(elements[4]) + ',' +
                epsilon(-elements[5]) + ',' +
                epsilon(elements[6]) + ',' +
                epsilon(elements[7]) + ',' +
                epsilon(elements[8]) + ',' +
                epsilon(-elements[9]) + ',' +
                epsilon(elements[10]) + ',' +
                epsilon(elements[11]) + ',' +
                epsilon(elements[12]) + ',' +
                epsilon(-elements[13]) + ',' +
                epsilon(elements[14]) + ',' +
                epsilon(elements[15]) +
                ')';

        }

        function getObjectCSSMatrix(matrix, cameraCSSMatrix)
        {

            const elements = matrix.elements;
            const matrix3d = 'matrix3d(' +
                epsilon(elements[0]) + ',' +
                epsilon(elements[1]) + ',' +
                epsilon(elements[2]) + ',' +
                epsilon(elements[3]) + ',' +
                epsilon(-elements[4]) + ',' +
                epsilon(-elements[5]) + ',' +
                epsilon(-elements[6]) + ',' +
                epsilon(-elements[7]) + ',' +
                epsilon(elements[8]) + ',' +
                epsilon(elements[9]) + ',' +
                epsilon(elements[10]) + ',' +
                epsilon(elements[11]) + ',' +
                epsilon(elements[12]) + ',' +
                epsilon(elements[13]) + ',' +
                epsilon(elements[14]) + ',' +
                epsilon(elements[15]) +
                ')';

            if (isIE)
            {

                return 'translate(-50%,-50%)' +
                    'translate(' + _widthHalf + 'px,' + _heightHalf + 'px)' +
                    cameraCSSMatrix +
                    matrix3d;

            }

            return 'translate(-50%,-50%)' + matrix3d;

        }

        function renderObject(object, scene, camera, cameraCSSMatrix)
        {

            if (object instanceof CSS3DObject)
            {

                object.onBeforeRender(_this, scene, camera);

                let style;

                if (object instanceof CSS3DSprite)
                {

                    // http://swiftcoder.wordpress.com/2008/11/25/constructing-a-billboard-matrix/

                    matrix.copy(camera.matrixWorldInverse);
                    matrix.transpose();
                    matrix.copyPosition(object.matrixWorld);
                    matrix.scale(object.scale);

                    matrix.elements[3]  = 0;
                    matrix.elements[7]  = 0;
                    matrix.elements[11] = 0;
                    matrix.elements[15] = 1;

                    style = getObjectCSSMatrix(matrix, cameraCSSMatrix);

                }
                else
                {

                    style = getObjectCSSMatrix(object.matrixWorld, cameraCSSMatrix);

                }

                const element      = object.element;
                const cachedObject = cache.objects.get(object);

                if (cachedObject === undefined || cachedObject.style !== style)
                {

                    element.style.WebkitTransform = style;
                    element.style.transform       = style;

                    const objectData = { style: style };

                    if (isIE)
                    {

                        objectData.distanceToCameraSquared = getDistanceToSquared(camera, object);

                    }

                    cache.objects.set(object, objectData);

                }

                element.style.display = object.visible ? '' : 'none';

                if (element.parentNode !== cameraElement)
                {

                    cameraElement.appendChild(element);

                }

                object.onAfterRender(_this, scene, camera);

            }

            for (let i = 0, l = object.children.length; i < l; i++)
            {

                renderObject(object.children[i], scene, camera, cameraCSSMatrix);

            }

        }

        const getDistanceToSquared = function ()
        {

            const a = new Vector3();
            const b = new Vector3();

            return function (object1, object2)
            {

                a.setFromMatrixPosition(object1.matrixWorld);
                b.setFromMatrixPosition(object2.matrixWorld);

                return a.distanceToSquared(b);

            };

        }();

        function filterAndFlatten(scene)
        {

            const result = [];

            scene.traverse(function (object)
            {

                if (object instanceof CSS3DObject)
                {
                    result.push(object);
                }

            });

            return result;

        }

        function zOrder(scene)
        {

            const sorted = filterAndFlatten(scene).sort(function (a, b)
            {

                const distanceA = cache.objects.get(a).distanceToCameraSquared;
                const distanceB = cache.objects.get(b).distanceToCameraSquared;

                return distanceA - distanceB;

            });

            const zMax = sorted.length;

            for (let i = 0, l = sorted.length; i < l; i++)
            {

                sorted[i].element.style.zIndex = zMax - i;

            }

        }

        this.render = function (scene, camera)
        {

            const fov = camera.projectionMatrix.elements[5] * _heightHalf;

            if (cache.camera.fov !== fov)
            {

                if (camera.isPerspectiveCamera)
                {

                    domElement.style.WebkitPerspective = fov + 'px';
                    domElement.style.perspective       = fov + 'px';

                }
                else
                {

                    domElement.style.WebkitPerspective = '';
                    domElement.style.perspective       = '';

                }

                cache.camera.fov = fov;

            }

            if (scene.autoUpdate === true)
            {
                scene.updateMatrixWorld();
            }
            if (camera.parent === null)
            {
                camera.updateMatrixWorld();
            }

            if (camera.isOrthographicCamera)
            {

                const tx = -(camera.right + camera.left) / 2;
                const ty = (camera.top + camera.bottom) / 2;

            }

            const cameraCSSMatrix = camera.isOrthographicCamera ?
                                  'scale(' + fov + ')' + 'translate(' + epsilon(tx) + 'px,' + epsilon(ty) + 'px)' + getCameraCSSMatrix(camera.matrixWorldInverse) :
                                  'translateZ(' + fov + 'px)' + getCameraCSSMatrix(camera.matrixWorldInverse);

            const style = cameraCSSMatrix +
                'translate(' + _widthHalf + 'px,' + _heightHalf + 'px)';

            if (cache.camera.style !== style && !isIE)
            {

                cameraElement.style.WebkitTransform = style;
                cameraElement.style.transform       = style;

                cache.camera.style = style;
            }

            renderObject(scene, scene, camera, cameraCSSMatrix);

            if (isIE)
            {

                // IE10 and 11 does not support 'preserve-3d'.
                // Thus, z-order in 3D will not work.
                // We have to calc z-order manually and set CSS z-index for IE.
                // FYI: z-index can't handle object intersection
                zOrder(scene);

            }

        };

    };

    return { CSS3DObject, CSS3DSprite, CSS3DRenderer };
};
