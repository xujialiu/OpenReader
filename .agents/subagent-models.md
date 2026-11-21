# GLM quota fallback

Start each subagent with its configured model. When the provider reports that the GLM usage allowance is exhausted, continue the same assignment with `gpt-6-luna` at reasoning effort `xhigh`. This switch is preauthorized.

If the named role pins GLM, dispatch a worker with the explicit model and effort and give it the same role instructions, working directory, source, and latest checkpoint. Carry forward the evidence and any recovery already spent. Report the quota error and the model used. An empty result or a timeout alone does not establish quota exhaustion.
