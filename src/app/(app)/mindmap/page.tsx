
'use client';

import React, { useCallback, useState, useRef, useEffect } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  OnConnect,
  OnEdgesDelete,
  OnNodesDelete,
  Node,
  Edge,
  NodeChange,
  applyNodeChanges,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useMindMapData } from '@/lib/data-hooks';
import { PlusCircle } from 'lucide-react';

let id = 2;
const getId = () => `${id++}`;

export default function MindMapPage() {
  const { data: mindMapData, updateData: setMindMapData, loading } = useMindMapData();

  const [nodes, setNodes, onNodesChange] = useNodesState(mindMapData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(mindMapData.edges);
  
  const [nodeName, setNodeName] = useState('');
  const yPos = useRef(50);
  const [rfInstance, setRfInstance] = useState<any>(null);

  useEffect(() => {
    setNodes(mindMapData.nodes);
    setEdges(mindMapData.edges);
    const maxId = mindMapData.nodes.reduce((max, node) => Math.max(max, parseInt(node.id, 10) || 0), 1);
    id = maxId + 1;
  }, [mindMapData, setNodes, setEdges]);
  
  const onConnect: OnConnect = useCallback(
    (params) => {
      setEdges((eds) => {
        const newEdges = addEdge(params, eds);
        setMindMapData({ nodes, edges: newEdges });
        return newEdges;
      });
    },
    [nodes, setEdges, setMindMapData]
  );

  const onNodesDelete: OnNodesDelete = useCallback(
    (deletedNodes) => {
      const remainingNodeIds = new Set(nodes.filter(n => !deletedNodes.some(dn => dn.id === n.id)).map(n => n.id));
      const remainingEdges = edges.filter(e => remainingNodeIds.has(e.source) && remainingNodeIds.has(e.target));
      setMindMapData({ nodes: nodes.filter(n => !deletedNodes.some(dn => dn.id === n.id)), edges: remainingEdges });
    },
    [nodes, edges, setMindMapData]
  );
  
  const onEdgesDelete: OnEdgesDelete = useCallback(
    (deleted) => {
        const remainingEdges = edges.filter(e => !deleted.some(de => de.id === e.id));
        setMindMapData({ nodes, edges: remainingEdges });
    },
    [nodes, edges, setMindMapData]
  );

  const handleCustomNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updatedNodes = applyNodeChanges(changes, nodes);
      setNodes(updatedNodes);

      // Check for label change and save
      const labelChange = changes.find(c => c.type === 'change' && c.data);
      if (labelChange) {
         setMindMapData({ nodes: updatedNodes, edges: edges });
      } else if (changes.some(c => c.type === 'position' && c.dragging === false)) {
         setMindMapData({ nodes: updatedNodes, edges: edges });
      }
    },
    [nodes, edges, setNodes, setMindMapData]
  );

  const handleAddNode = () => {
    if (!nodeName) return;
    yPos.current += 70;
    const newNode: Node = {
      id: getId(),
      position: { x: Math.random() * 400, y: yPos.current },
      data: { label: nodeName },
    };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    setMindMapData({ nodes: newNodes, edges: edges });
    setNodeName('');
  };
  
  if (loading) {
    return <div>Loading Mind Map...</div>
  }

  return (
    <div className="grid md:grid-cols-3 gap-8 h-full">
      <div className="md:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle>My Mind Map</CardTitle>
            <CardDescription>Create and connect ideas. This is your personal space.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                placeholder="New idea..."
                onKeyDown={(e) => e.key === 'Enter' && handleAddNode()}
              />
              <Button onClick={handleAddNode} className="w-full">
                <PlusCircle className="mr-2" /> Add Node
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="md:col-span-2 h-[75vh] rounded-lg border bg-card">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleCustomNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onInit={setRfInstance}
          fitView
        >
          <Controls />
          <MiniMap style={{ height: 80, width: 120 }} />
          <Background gap={12} size={1} />
        </ReactFlow>
      </div>
    </div>
  );
}
