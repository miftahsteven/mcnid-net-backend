import { DirectedGraph } from "graphology";
import pagerank from "graphology-metrics/centrality/pagerank";
import louvain from "graphology-communities-louvain";
import { TwitterTweetItem, GraphNode, GraphEdge } from "./sna.types";

export class SnaGraphBuilder {
  private graph: DirectedGraph;

  constructor() {
    this.graph = new DirectedGraph();
  }

  /**
   * Build graph from items: Retweets, Replies, Mentions
   */
  build(items: TwitterTweetItem[]): void {
    items.forEach((item) => {
      const sourceUser = item.author?.userName;
      if (!sourceUser) return;
      
      this.ensureNode(sourceUser);

      const targets = new Set<{ name: string, type: string }>();

      // 1. Retweets (A retweets B)
      if (item.retweetedStatus?.author?.userName) {
        targets.add({ name: item.retweetedStatus.author.userName, type: "retweet" });
      }
      
      // 2. Quotes (A quotes B)
      if (item.quotedStatus?.author?.userName) {
        targets.add({ name: item.quotedStatus.author.userName, type: "quote" });
      }

      // 3. Replies (A replies to B)
      if (item.inReplyToUserName) {
        targets.add({ name: item.inReplyToUserName, type: "reply" });
      }

      // 4. Mentions (A mentions B)
      if (item.entities?.user_mentions) {
        item.entities.user_mentions.forEach((mention) => {
          if (mention.screen_name) {
            targets.add({ name: mention.screen_name, type: "mention" });
          }
        });
      }

      // Add all identified interactions as edges
      targets.forEach(target => {
        this.ensureNode(target.name);
        this.ensureEdge(sourceUser, target.name, target.type);
      });
    });

    console.log(`[SNA] Graph built with ${this.graph.order} nodes and ${this.graph.size} edges`);
  }

  private ensureNode(id: string) {
    if (!this.graph.hasNode(id)) {
      this.graph.addNode(id, { label: `@${id}`, size: 2 });
    }
  }

  private ensureEdge(source: string, target: string, type: string) {
    if (source === target) return; // Skip self-loops
    if (this.graph.hasEdge(source, target)) {
      // Increment weight for repeated interactions
      const weight = (this.graph.getEdgeAttribute(source, target, "weight") || 1) + 1;
      this.graph.setEdgeAttribute(source, target, "weight", weight);
    } else {
      this.graph.addEdge(source, target, { type, weight: 1 });
    }
  }

  /**
   * Run network analytics
   */
  analyze() {
    // 1. PageRank for influence
    const pr = pagerank(this.graph);
    this.graph.forEachNode((node, attr) => {
      this.graph.setNodeAttribute(node, "size", 5 + (pr[node] * 100));
      this.graph.setNodeAttribute(node, "score", pr[node]);
    });

    // 2. Louvain for communities
    const communities = louvain(this.graph);
    this.graph.forEachNode((node) => {
      this.graph.setNodeAttribute(node, "cluster", communities[node]);
    });

    // Get Top Influencers
    const topInfluencers = this.graph.nodes()
      .map(node => ({
        username: node,
        score: this.graph.getNodeAttribute(node, "score") as number
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const clustersCount = new Set(Object.values(communities)).size;

    return {
      topInfluencers,
      mainClusters: clustersCount,
    };
  }

  getGraphData() {
    const nodes: GraphNode[] = this.graph.nodes().map(node => ({
      id: node,
      label: node,
      size: this.graph.getNodeAttribute(node, "size") as number,
      cluster: this.graph.getNodeAttribute(node, "cluster") as number
    }));

    const edges: GraphEdge[] = this.graph.edges().map(edge => {
      const [source, target] = this.graph.extremities(edge);
      return {
        source,
        target,
        type: this.graph.getEdgeAttribute(edge, "type") as string,
        weight: this.graph.getEdgeAttribute(edge, "weight") as number || 1
      };
    });

    return { nodes, edges };
  }
}
