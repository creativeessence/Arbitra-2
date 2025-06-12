# Arbitra-2
Opensea + Blur Bidding // Offer Acceptor Software

A2-BLUR-Bids
nothing wrong with it runs smoothly and stored perfectly - no changes needed

a2-opensea-bids
nothing wrong with it runs smoothly, need to check if it needs the extra API call to begin with. monitoring for Order Invalidation if order is not valid then 

A3 - blur amount
nothing wrong takes 0.005 eth off bid and then rounds to nearest 0.01 based on opensea bid

A3 - opensea amount
nothing wrong takes 0.005 eth off bid and then based on blur bid makes offer. If offer is higher already we submit our max
if lower we then outbid by 0.00001

a4 - submit blur
calculates and submits bids perfectly. Just need to ensure it checks for current bids and if it matches then we keep, remove or update our bids for blur. Make it event based.

a4 - submit opensea
****** cannot work out how to do this what so ever. will get Danu to do it for me. Only got the build-offer.cjs working which is 1/2 way their.

a5 - blur acceptor
Works fully by monitoring NFT's in wallet, if ones detected then we auto-generate everything that's needed to submit onchain. Only onchain part won't work only thing that needs doing is being able to submit onchain.

a5 - opensea acceptor
works fully by monitoring NFT's in wallet, if one detected then we auto-generate everything that's needed to submit onchain. Only need to add onchain submission!
