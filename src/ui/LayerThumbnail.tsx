import {memo,useEffect,useRef} from 'react';
import type {Layer} from '../engine/document';
import {renderLayerThumbnail} from '../engine/previews';
export default memo(function LayerThumbnail({layer,revision,opacity=1}:{layer:Layer;revision:number;opacity?:number}){const ref=useRef<HTMLCanvasElement>(null);useEffect(()=>{renderLayerThumbnail(layer,ref.current)},[layer,revision]);return <canvas className="layer-thumb" width={48} height={32} ref={ref} style={{opacity}} aria-label={`${layer.name} thumbnail`}/>;});
