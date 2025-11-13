

'use client';

import React, { useCallback, useState, useRef } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  addEdge,
  removeElements,
  useNodesState,
  useEdgesState,
  OnConnect,
  OnEdgesDelete,
  OnNodesDelete,
  Node,
  Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useMindMapData } from '@/lib/data-hooks';
import { PlusCircle, Trash2 } from 'lucide-react';

let id = 2;
const getId = () => `${id++}`;

export default function MindMapPage() {
  const { data: mindMapData, updateData: setMindMapData, loading } = useMindMapData();
  const { nodes, edges } = mindMapData;

  const [nodesState, setNodes, onNodesChange] = useNodesState(nodes);
  const [edgesState, setEdges, onEdgesChange] = useEdgesState(edges);
  
  const [nodeName, setNodeName] = useState('');
  const yPos = useRef(50);

  React.useEffect(() => {
    setNodes(nodes);
    setEdges(edges);
  }, [nodes, edges, setNodes, setEdges]);
  
  const onConnect: OnConnect = useCallback(
    (params) => {
      const newEdges = addEdge(params, edgesState);
      setEdges(newEdges);
      setMindMapData({ nodes: nodesState, edges: newEdges });
    },
    [edgesState, nodesState, setEdges, setMindMapData]
  );

  const onNodesDelete: OnNodesDelete = useCallback(
    (deleted) => {
        const remainingNodes = nodesState.filter(n => !deleted.some(dn => dn.id === n.id));
        setMindMapData({ nodes: remainingNodes, edges: edgesState });
    },
    [nodesState, edgesState, setMindMapData]
  );
  
   const onEdgesDelete: OnEdgesDelete = useCallback(
    (deleted) => {
        const remainingEdges = edgesState.filter(e => !deleted.some(de => de.id === e.id));
        setMindMapData({ nodes: nodesState, edges: remainingEdges });
    },
    [nodesState, edgesState, setMindMapData]
  );


  const handleAddNode = () => {
    if (!nodeName) return;
    const newNode: Node = {
      id: getId(),
      position: { x: Math.random() * 400, y: yPos.current },
      data: { label: nodeName },
    };
    yPos.current += 70;
    const newNodes = [...nodesState, newNode];
    setNodes(newNodes);
    setMindMapData({ nodes: newNodes, edges: edgesState });
    setNodeName('');
  };

  const handleNodeLabelChange = (nodeId: string, newLabel: string) => {
    const newNodes = nodesState.map((node) => {
      if (node.id === nodeId) {
        return { ...node, data: { ...node.data, label: newLabel } };
      }
      return node;
    });
    setNodes(newNodes);
    setMindMapData({ nodes: newNodes, edges: edgesState });
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
          nodes={nodesState}
          edges={edgesState}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          fitView
        >
          <Controls />
          <MiniMap />
          <Background gap={12} size={1} />
        </ReactFlow>
      </div>
    </div>
  );
}
